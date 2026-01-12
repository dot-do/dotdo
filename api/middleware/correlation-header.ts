/**
 * Correlation Header Utilities
 *
 * Utilities for generating and parsing the X-Dotdo-Request header.
 * This header enables frontend-to-backend request tracing and session replay correlation.
 *
 * Header format: {sessionId}/{requestId}/{timestamp}
 *
 * Related issues:
 * - dotdo-8v64: [Green] Implement correlation header utilities
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * The name of the correlation header (lowercase for consistency with HTTP/2)
 */
export const CORRELATION_HEADER_NAME = 'x-dotdo-request'

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed components of a correlation header
 */
export interface ParsedCorrelationHeader {
  /** Session identifier linking multiple requests */
  sessionId: string
  /** Unique identifier for this specific request */
  requestId: string
  /** Unix timestamp in milliseconds when the request was generated */
  timestamp: number
}

// ============================================================================
// Request ID Generation
// ============================================================================

/**
 * Generates a unique, URL-safe request ID.
 *
 * Uses crypto.randomUUID() for cryptographic randomness, then extracts
 * a portion to create a shorter, URL-safe ID.
 *
 * @returns A unique request ID (alphanumeric with dashes, 8-32 chars)
 */
export function generateRequestId(): string {
  // Use crypto.randomUUID() for cryptographic randomness
  // Remove dashes and take first 16 characters for a shorter ID
  const uuid = crypto.randomUUID()
  return uuid.replace(/-/g, '').slice(0, 16)
}

// ============================================================================
// Header Generation
// ============================================================================

/**
 * Generates a correlation header value for a request.
 *
 * Format: {sessionId}/{requestId}/{timestamp}
 *
 * @param sessionId - The session identifier to include in the header
 * @returns The formatted correlation header value
 *
 * @example
 * ```typescript
 * const header = generateCorrelationHeader('user-session-123')
 * // Returns: "user-session-123/a1b2c3d4e5f6g7h8/1736424000000"
 * ```
 */
export function generateCorrelationHeader(sessionId: string): string {
  const requestId = generateRequestId()
  const timestamp = Date.now()
  return `${sessionId}/${requestId}/${timestamp}`
}

// ============================================================================
// Header Parsing
// ============================================================================

/**
 * Parses a correlation header value into its components.
 *
 * @param header - The correlation header value to parse
 * @returns Parsed components, or null if the header is invalid
 *
 * @example
 * ```typescript
 * const parsed = parseCorrelationHeader('session-abc/req-xyz/1736424000000')
 * // Returns: { sessionId: 'session-abc', requestId: 'req-xyz', timestamp: 1736424000000 }
 *
 * const invalid = parseCorrelationHeader('invalid-header')
 * // Returns: null
 * ```
 */
export function parseCorrelationHeader(header: string): ParsedCorrelationHeader | null {
  // Handle null, undefined, or non-string inputs
  if (header == null || typeof header !== 'string') {
    return null
  }

  // Trim whitespace
  const trimmed = header.trim()

  // Handle empty string
  if (trimmed === '') {
    return null
  }

  // Split by '/'
  const parts = trimmed.split('/')

  // Must have exactly 3 parts
  if (parts.length !== 3) {
    return null
  }

  const [sessionId, requestId, timestampStr] = parts

  // Parse timestamp
  const timestamp = parseInt(timestampStr!, 10)

  // Validate timestamp is a valid positive integer
  if (isNaN(timestamp) || timestamp <= 0 || timestampStr !== String(timestamp)) {
    return null
  }

  return {
    sessionId: sessionId!,
    requestId: requestId!,
    timestamp,
  }
}

// ============================================================================
// Hono Middleware (Optional - for easy integration)
// ============================================================================

import type { MiddlewareHandler } from 'hono'

/**
 * Hono middleware that extracts and stores correlation header data.
 *
 * If the X-Dotdo-Request header is present, parses it and stores in context.
 * Also sets the header on the response for tracing.
 *
 * @example
 * ```typescript
 * import { correlationMiddleware } from './correlation-header'
 *
 * app.use('*', correlationMiddleware)
 *
 * app.get('/api/data', (c) => {
 *   const correlation = c.get('correlation')
 *   // { sessionId: '...', requestId: '...', timestamp: ... }
 * })
 * ```
 */
export const correlationMiddleware: MiddlewareHandler = async (c, next) => {
  const headerValue = c.req.header(CORRELATION_HEADER_NAME)

  if (headerValue) {
    const parsed = parseCorrelationHeader(headerValue)
    if (parsed) {
      c.set('correlation', parsed)
    }
  }

  await next()

  // Echo the correlation header in the response for tracing
  if (headerValue) {
    c.header(CORRELATION_HEADER_NAME, headerValue)
  }
}

export default correlationMiddleware
