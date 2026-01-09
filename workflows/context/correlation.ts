/**
 * Correlation Headers and Context for Request Tracing
 *
 * Enables request tracing across services with:
 * - X-Correlation-ID: Primary correlation identifier
 * - X-Request-ID: Request-specific identifier
 * - X-Dotdo-Request: Combined header with full trace context
 *
 * Header format for X-Dotdo-Request:
 * ```
 * {correlationId}.{requestId}.{timestamp}.{sequence}[.{spanId}[.{parentSpanId}]]
 * Example: corr-abc123.req-xyz789.1704067200000.1.span-123.span-parent
 * ```
 *
 * The correlation system:
 * - Generates new correlation IDs for root requests
 * - Propagates correlation through DO calls
 * - Creates child spans for nested requests
 * - Links frontend events to backend traces
 *
 * @module workflows/context/correlation
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Correlation context containing trace information
 */
export interface CorrelationContext {
  /** Primary correlation identifier - groups all events in a trace */
  correlationId: string
  /** Request-specific identifier - unique per request */
  requestId: string
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Sequence number within the trace */
  sequence: number
  /** Current span identifier */
  spanId?: string
  /** Parent span identifier for nested calls */
  parentSpanId?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Header name for the combined dotdo request header */
export const DOTDO_REQUEST_HEADER = 'X-Dotdo-Request'

/** Header name for correlation ID */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID'

/** Header name for request ID */
export const REQUEST_ID_HEADER = 'X-Request-ID'

/** Maximum length for correlation/request IDs */
const MAX_ID_LENGTH = 128

/** Characters allowed in IDs (URL-safe, no injection risks) */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

/** Pattern for detecting dangerous characters (global for replace) */
const DANGEROUS_CHARS_PATTERN = /[<>;'"\\`\r\n${}]/g

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Generates a cryptographically random hex string
 */
function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generates a unique correlation ID.
 *
 * Format: corr-{timestamp_hex}{random_hex}
 * - Prefix "corr-" for identification
 * - 8 chars timestamp (hex) for time-sortability
 * - 8 chars random for uniqueness
 *
 * Total length: 21 characters
 *
 * @returns A unique correlation ID string
 *
 * @example
 * ```typescript
 * const id = generateCorrelationId()
 * // "corr-18d4f8a0b1c2d3e4"
 * ```
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(16).padStart(12, '0').slice(-12)
  const random = randomHex(4)
  return `corr-${timestamp}${random}`
}

/**
 * Generates a unique request ID.
 *
 * Format: req-{random_hex}
 * - Prefix "req-" for identification
 * - 8 chars random hex
 *
 * Total length: 12 characters (shorter than correlation ID)
 *
 * @returns A unique request ID string
 *
 * @example
 * ```typescript
 * const id = generateRequestId()
 * // "req-a1b2c3d4"
 * ```
 */
export function generateRequestId(): string {
  return `req-${randomHex(4)}`
}

/**
 * Generates a unique span ID.
 *
 * Format: span-{random_hex}
 * - Prefix "span-" for identification
 * - 8 chars random hex
 *
 * @returns A unique span ID string
 */
function generateSpanId(): string {
  return `span-${randomHex(4)}`
}

// ============================================================================
// VALIDATION & SANITIZATION
// ============================================================================

/**
 * Sanitizes an ID by removing dangerous characters and truncating
 */
function sanitizeId(id: string): string {
  // Remove dangerous characters
  let sanitized = id.replace(DANGEROUS_CHARS_PATTERN, '')

  // Truncate to max length
  if (sanitized.length > MAX_ID_LENGTH) {
    sanitized = sanitized.slice(0, MAX_ID_LENGTH)
  }

  return sanitized
}

/**
 * Validates that an ID is safe (URL-safe characters only)
 */
function isValidId(id: string): boolean {
  if (!id || id.length === 0 || id.length > MAX_ID_LENGTH) {
    return false
  }
  return SAFE_ID_PATTERN.test(id)
}

/**
 * Validates that a timestamp is reasonable
 */
function isValidTimestamp(timestamp: number): boolean {
  if (typeof timestamp !== 'number' || !Number.isInteger(timestamp)) {
    return false
  }
  // Allow some clock skew but reject clearly invalid values
  // Minimum: 2000-01-01, Maximum: 100 years in the future
  const minTimestamp = 946684800000 // 2000-01-01
  const maxTimestamp = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000
  return timestamp >= minTimestamp && timestamp <= maxTimestamp
}

/**
 * Validates that a sequence is a positive integer
 */
function isValidSequence(sequence: number): boolean {
  return Number.isInteger(sequence) && sequence >= 1
}

// ============================================================================
// HEADER CREATION
// ============================================================================

/**
 * Creates the X-Dotdo-Request header value from a correlation context.
 *
 * Format: {correlationId}.{requestId}.{timestamp}.{sequence}[.{spanId}[.{parentSpanId}]]
 *
 * Missing fields will be auto-generated.
 *
 * @param ctx - Partial correlation context (missing fields are generated)
 * @returns The header value string
 *
 * @example
 * ```typescript
 * const header = createDotdoRequestHeader({
 *   correlationId: 'corr-abc123',
 *   requestId: 'req-xyz789',
 *   timestamp: 1704067200000,
 *   sequence: 1
 * })
 * // "corr-abc123.req-xyz789.1704067200000.1"
 * ```
 */
export function createDotdoRequestHeader(ctx: Partial<CorrelationContext>): string {
  // Auto-generate missing fields
  const correlationId = sanitizeId(ctx.correlationId || generateCorrelationId())
  const requestId = sanitizeId(ctx.requestId || generateRequestId())
  const timestamp = ctx.timestamp ?? Date.now()
  const sequence = ctx.sequence ?? 1

  // Build base header
  let header = `${correlationId}.${requestId}.${timestamp}.${sequence}`

  // Add optional span IDs
  if (ctx.spanId) {
    header += `.${sanitizeId(ctx.spanId)}`
    if (ctx.parentSpanId) {
      header += `.${sanitizeId(ctx.parentSpanId)}`
    }
  }

  return header
}

// ============================================================================
// HEADER PARSING
// ============================================================================

/**
 * Parses the X-Dotdo-Request header value into a correlation context.
 *
 * @param header - The header value to parse
 * @returns The parsed correlation context
 * @throws Error if the header is malformed or contains invalid values
 *
 * @example
 * ```typescript
 * const ctx = parseDotdoRequestHeader('corr-abc123.req-xyz789.1704067200000.1')
 * // { correlationId: 'corr-abc123', requestId: 'req-xyz789', timestamp: 1704067200000, sequence: 1 }
 * ```
 */
export function parseDotdoRequestHeader(header: string): CorrelationContext {
  if (!header || typeof header !== 'string') {
    throw new Error('Invalid header: header must be a non-empty string')
  }

  const parts = header.split('.')

  // Must have at least 4 parts: correlationId, requestId, timestamp, sequence
  if (parts.length < 4) {
    throw new Error(`Invalid header format: expected at least 4 dot-separated parts, got ${parts.length}`)
  }

  const [correlationId, requestId, timestampStr, sequenceStr, spanId, parentSpanId] = parts

  // Validate correlationId
  if (!isValidId(correlationId)) {
    throw new Error(`Invalid correlationId: must be alphanumeric with dashes/underscores, got "${correlationId}"`)
  }

  // Validate requestId
  if (!isValidId(requestId)) {
    throw new Error(`Invalid requestId: must be alphanumeric with dashes/underscores, got "${requestId}"`)
  }

  // Parse and validate timestamp
  const timestamp = parseInt(timestampStr, 10)
  if (isNaN(timestamp) || !isValidTimestamp(timestamp)) {
    throw new Error(`Invalid timestamp: must be a valid Unix timestamp in milliseconds, got "${timestampStr}"`)
  }

  // Parse and validate sequence
  const sequence = parseInt(sequenceStr, 10)
  if (isNaN(sequence) || !isValidSequence(sequence)) {
    throw new Error(`Invalid sequence: must be a positive integer >= 1, got "${sequenceStr}"`)
  }

  // Build context
  const ctx: CorrelationContext = {
    correlationId,
    requestId,
    timestamp,
    sequence,
  }

  // Add optional span IDs if present
  if (spanId && isValidId(spanId)) {
    ctx.spanId = spanId
    if (parentSpanId && isValidId(parentSpanId)) {
      ctx.parentSpanId = parentSpanId
    }
  }

  return ctx
}

// ============================================================================
// REQUEST EXTRACTION & INJECTION
// ============================================================================

/**
 * Extracts correlation context from a Request's headers.
 *
 * Checks headers in priority order:
 * 1. X-Dotdo-Request (full context)
 * 2. X-Correlation-ID + X-Request-ID (fallback)
 * 3. X-Correlation-ID only
 * 4. X-Request-ID only
 *
 * @param request - The Request object to extract from
 * @returns The correlation context, or null if no correlation headers found
 *
 * @example
 * ```typescript
 * const request = new Request('http://localhost/api/test', {
 *   headers: { 'X-Dotdo-Request': 'corr-abc123.req-xyz789.1704067200000.1' }
 * })
 * const ctx = extractCorrelationFromRequest(request)
 * // { correlationId: 'corr-abc123', requestId: 'req-xyz789', ... }
 * ```
 */
export function extractCorrelationFromRequest(request: Request): CorrelationContext | null {
  // Priority 1: X-Dotdo-Request header (full context)
  const dotdoHeader = request.headers.get(DOTDO_REQUEST_HEADER)
  if (dotdoHeader) {
    try {
      return parseDotdoRequestHeader(dotdoHeader)
    } catch {
      // Fall through to individual headers
    }
  }

  // Priority 2: Individual headers
  const correlationId = request.headers.get(CORRELATION_ID_HEADER)
  const requestId = request.headers.get(REQUEST_ID_HEADER)

  // No correlation headers found
  if (!correlationId && !requestId) {
    return null
  }

  // Build partial context from individual headers
  const ctx: CorrelationContext = {
    correlationId: correlationId || generateCorrelationId(),
    requestId: requestId || generateRequestId(),
    timestamp: Date.now(),
    sequence: 1,
  }

  return ctx
}

/**
 * Injects correlation headers into a Request.
 *
 * Sets:
 * - X-Correlation-ID
 * - X-Request-ID
 * - X-Dotdo-Request (combined)
 *
 * Note: Increments sequence number for propagation.
 *
 * @param request - The original Request
 * @param ctx - The correlation context to inject
 * @returns A new Request with correlation headers added
 *
 * @example
 * ```typescript
 * const ctx = { correlationId: 'corr-abc', requestId: 'req-xyz', timestamp: Date.now(), sequence: 1 }
 * const newRequest = injectCorrelationHeaders(originalRequest, ctx)
 * // newRequest has X-Correlation-ID, X-Request-ID, X-Dotdo-Request headers
 * ```
 */
export function injectCorrelationHeaders(request: Request, ctx: CorrelationContext): Request {
  // Clone headers and add correlation headers
  const headers = new Headers(request.headers)

  // Create propagation context with incremented sequence
  const propagationCtx: CorrelationContext = {
    ...ctx,
    sequence: ctx.sequence + 1,
  }

  // Set all correlation headers
  headers.set(CORRELATION_ID_HEADER, propagationCtx.correlationId)
  headers.set(REQUEST_ID_HEADER, propagationCtx.requestId)
  headers.set(DOTDO_REQUEST_HEADER, createDotdoRequestHeader(propagationCtx))

  // Create new request with updated headers
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    mode: request.mode,
    credentials: request.credentials,
    cache: request.cache,
    redirect: request.redirect,
    referrer: request.referrer,
    integrity: request.integrity,
  })
}

// ============================================================================
// SPAN MANAGEMENT
// ============================================================================

/**
 * Creates a child span from a parent correlation context.
 *
 * Child spans:
 * - Inherit the correlationId (same trace)
 * - Get a new requestId
 * - Get a new spanId
 * - Reference parent's spanId as parentSpanId
 * - Increment sequence
 * - Use current timestamp
 *
 * @param parent - The parent correlation context
 * @returns A new child correlation context
 *
 * @example
 * ```typescript
 * const parent = { correlationId: 'corr-abc', spanId: 'span-123', sequence: 1, ... }
 * const child = createChildSpan(parent)
 * // { correlationId: 'corr-abc', spanId: 'span-xyz', parentSpanId: 'span-123', sequence: 2, ... }
 * ```
 */
export function createChildSpan(parent: CorrelationContext): CorrelationContext {
  return {
    correlationId: parent.correlationId,
    requestId: generateRequestId(),
    timestamp: Date.now(),
    sequence: parent.sequence + 1,
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
  }
}

// ============================================================================
// SESSION CORRELATION
// ============================================================================

/**
 * Creates a correlation context from a session ID.
 *
 * Useful for linking frontend session events to backend traces.
 * The same session ID will always produce the same base correlation ID
 * (deterministic for grouping).
 *
 * @param sessionId - The session identifier
 * @returns A correlation context tied to the session
 *
 * @example
 * ```typescript
 * const ctx = createSessionCorrelation('session-user123')
 * // ctx.correlationId will include 'session-user123' for consistent grouping
 * ```
 */
export function createSessionCorrelation(sessionId: string): CorrelationContext {
  // Create deterministic correlation ID from session ID
  const correlationId = `${sanitizeId(sessionId)}`

  return {
    correlationId,
    requestId: generateRequestId(),
    timestamp: Date.now(),
    sequence: 1,
  }
}

/**
 * Links a frontend event to a backend correlation context.
 *
 * Returns true if the frontend event's correlationId matches
 * the backend context's correlationId.
 *
 * @param frontendEvent - The frontend event with correlationId
 * @param backendCtx - The backend correlation context
 * @returns true if the events are linked (same correlation)
 *
 * @example
 * ```typescript
 * const frontendEvent = { correlationId: 'corr-abc123', type: 'request', data: {} }
 * const backendCtx = { correlationId: 'corr-abc123', ... }
 * const isLinked = linkFrontendToBackend(frontendEvent, backendCtx)
 * // true
 * ```
 */
export function linkFrontendToBackend(
  frontendEvent: { correlationId: string },
  backendCtx: CorrelationContext
): boolean {
  return frontendEvent.correlationId === backendCtx.correlationId
}

// ============================================================================
// MIDDLEWARE (Hono-compatible)
// ============================================================================

/**
 * Hono middleware context type (minimal)
 */
interface HonoContext {
  req: {
    raw: Request
    header(name: string): string | undefined
  }
  set(key: string, value: unknown): void
  header(name: string, value: string): void
}

/**
 * Hono middleware next function type
 */
type HonoNext = () => Promise<void>

/**
 * Creates a Hono middleware for correlation header propagation.
 *
 * This middleware:
 * 1. Extracts correlation context from incoming request
 * 2. Generates new context if none exists (root request)
 * 3. Stores context in c.set('correlation', ctx) for handlers
 * 4. Adds correlation headers to the response
 *
 * @returns Hono middleware function
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { correlationMiddleware } from './correlation'
 *
 * const app = new Hono()
 * app.use('*', correlationMiddleware())
 *
 * app.get('/api/test', (c) => {
 *   const ctx = c.get('correlation')
 *   return c.json({ correlationId: ctx.correlationId })
 * })
 * ```
 */
export function correlationMiddleware() {
  return async (c: HonoContext, next: HonoNext) => {
    // Extract or create correlation context
    let ctx = extractCorrelationFromRequest(c.req.raw)

    if (!ctx) {
      // Root request - create new correlation context
      ctx = {
        correlationId: generateCorrelationId(),
        requestId: generateRequestId(),
        timestamp: Date.now(),
        sequence: 1,
        spanId: generateSpanId(),
      }
    } else if (!ctx.spanId) {
      // Add span ID if not present
      ctx = {
        ...ctx,
        spanId: generateSpanId(),
      }
    }

    // Store context for handlers
    c.set('correlation', ctx)

    // Process request
    await next()

    // Add correlation headers to response
    c.header(CORRELATION_ID_HEADER, ctx.correlationId)
    c.header(REQUEST_ID_HEADER, ctx.requestId)
    c.header(DOTDO_REQUEST_HEADER, createDotdoRequestHeader(ctx))
  }
}
