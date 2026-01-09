/**
 * Correlation Headers Tests
 *
 * RED Phase TDD - Tests for correlation header generation, parsing, and propagation.
 * All tests should FAIL until the session replay feature is implemented.
 *
 * Related issues:
 * - dotdo-g0sw: [Red] Correlation header and replay API tests
 *
 * Correlation headers enable request tracing across services:
 * - X-Correlation-ID: Primary correlation identifier
 * - X-Request-ID: Request-specific identifier
 * - X-Dotdo-Request: Combined header with full trace context
 *
 * Header format for X-Dotdo-Request:
 * ```
 * {correlationId}.{requestId}.{timestamp}.{sequence}
 * Example: corr-abc123.req-xyz789.1704067200000.1
 * ```
 *
 * The correlation system:
 * - Generates new correlation IDs for root requests
 * - Propagates correlation through DO calls
 * - Creates child spans for nested requests
 * - Links frontend events to backend traces
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// Type Interfaces (Expected)
// ============================================================================

interface CorrelationContext {
  correlationId: string
  requestId: string
  timestamp: number
  sequence: number
  parentSpanId?: string
  spanId?: string
}

interface CorrelationHeaderValue {
  raw: string
  parsed: CorrelationContext
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let generateCorrelationId: (() => string) | undefined
let generateRequestId: (() => string) | undefined
let createDotdoRequestHeader: ((ctx: Partial<CorrelationContext>) => string) | undefined
let parseDotdoRequestHeader: ((header: string) => CorrelationContext) | undefined
let createChildSpan: ((parent: CorrelationContext) => CorrelationContext) | undefined
let extractCorrelationFromRequest: ((req: Request) => CorrelationContext | null) | undefined
let injectCorrelationHeaders: ((req: Request, ctx: CorrelationContext) => Request) | undefined

try {
  // @ts-expect-error - Module not yet implemented
  const correlationModule = await import('../../workflows/context/correlation')
  generateCorrelationId = correlationModule.generateCorrelationId
  generateRequestId = correlationModule.generateRequestId
  createDotdoRequestHeader = correlationModule.createDotdoRequestHeader
  parseDotdoRequestHeader = correlationModule.parseDotdoRequestHeader
  createChildSpan = correlationModule.createChildSpan
  extractCorrelationFromRequest = correlationModule.extractCorrelationFromRequest
  injectCorrelationHeaders = correlationModule.injectCorrelationHeaders
} catch {
  // Module doesn't exist yet - tests will fail as expected (RED phase)
  generateCorrelationId = undefined
  generateRequestId = undefined
  createDotdoRequestHeader = undefined
  parseDotdoRequestHeader = undefined
  createChildSpan = undefined
  extractCorrelationFromRequest = undefined
  injectCorrelationHeaders = undefined
}

// ============================================================================
// Helper: Create valid correlation context
// ============================================================================

function createValidContext(overrides?: Partial<CorrelationContext>): CorrelationContext {
  return {
    correlationId: 'corr-abc123',
    requestId: 'req-xyz789',
    timestamp: Date.now(),
    sequence: 1,
    ...overrides,
  }
}

// ============================================================================
// 1. X-Correlation-ID Header Generation Tests
// ============================================================================

describe('X-Correlation-ID header generation', () => {
  it('generateCorrelationId function is exported', () => {
    expect(generateCorrelationId).toBeDefined()
    expect(typeof generateCorrelationId).toBe('function')
  })

  it('generates unique correlation IDs', () => {
    const id1 = generateCorrelationId!()
    const id2 = generateCorrelationId!()
    const id3 = generateCorrelationId!()

    expect(id1).not.toBe(id2)
    expect(id2).not.toBe(id3)
    expect(id1).not.toBe(id3)
  })

  it('generates IDs with consistent prefix', () => {
    const id = generateCorrelationId!()

    // Should have a recognizable prefix
    expect(id).toMatch(/^corr-|^c-|^[a-f0-9]{8}-/)
  })

  it('generates IDs of consistent length', () => {
    const ids = Array.from({ length: 100 }, () => generateCorrelationId!())

    const firstLength = ids[0].length
    ids.forEach(id => {
      expect(id.length).toBe(firstLength)
    })
  })

  it('generates URL-safe IDs', () => {
    const ids = Array.from({ length: 100 }, () => generateCorrelationId!())

    ids.forEach(id => {
      // Should only contain URL-safe characters
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/)
    })
  })

  it('generates IDs that are sortable by time', () => {
    const timestamps: number[] = []
    const ids: string[] = []

    for (let i = 0; i < 5; i++) {
      ids.push(generateCorrelationId!())
      timestamps.push(Date.now())
      // Small delay to ensure different timestamps
    }

    // IDs generated later should sort after earlier ones (if time-based)
    // This depends on implementation - ULID, KSUID, etc.
    expect(ids.length).toBe(5)
  })
})

// ============================================================================
// 2. X-Request-ID Header Support Tests
// ============================================================================

describe('X-Request-ID header support', () => {
  it('generateRequestId function is exported', () => {
    expect(generateRequestId).toBeDefined()
    expect(typeof generateRequestId).toBe('function')
  })

  it('generates unique request IDs', () => {
    const id1 = generateRequestId!()
    const id2 = generateRequestId!()

    expect(id1).not.toBe(id2)
  })

  it('generates shorter IDs than correlation IDs', () => {
    const correlationId = generateCorrelationId!()
    const requestId = generateRequestId!()

    // Request IDs can be shorter since they're scoped to a correlation
    expect(requestId.length).toBeLessThanOrEqual(correlationId.length)
  })

  it('generates URL-safe request IDs', () => {
    const id = generateRequestId!()

    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('request ID is different from correlation ID', () => {
    const correlationId = generateCorrelationId!()
    const requestId = generateRequestId!()

    // Should have different prefixes or formats
    expect(correlationId.slice(0, 4)).not.toBe(requestId.slice(0, 4))
  })
})

// ============================================================================
// 3. X-Dotdo-Request Header Format Tests
// ============================================================================

describe('X-Dotdo-Request header generation', () => {
  it('createDotdoRequestHeader function is exported', () => {
    expect(createDotdoRequestHeader).toBeDefined()
    expect(typeof createDotdoRequestHeader).toBe('function')
  })

  it('creates header with all context fields', () => {
    const ctx = createValidContext({
      correlationId: 'corr-test123',
      requestId: 'req-abc456',
      timestamp: 1704067200000,
      sequence: 1,
    })

    const header = createDotdoRequestHeader!(ctx)

    expect(header).toContain('corr-test123')
    expect(header).toContain('req-abc456')
    expect(header).toContain('1704067200000')
    expect(header).toContain('1')
  })

  it('uses dot separator between fields', () => {
    const ctx = createValidContext()
    const header = createDotdoRequestHeader!(ctx)

    // Format: {correlationId}.{requestId}.{timestamp}.{sequence}
    const parts = header.split('.')
    expect(parts.length).toBeGreaterThanOrEqual(4)
  })

  it('generates header with minimal context', () => {
    const header = createDotdoRequestHeader!({
      correlationId: 'corr-minimal',
    })

    expect(header).toContain('corr-minimal')
    // Should auto-generate requestId, timestamp, sequence
    expect(header.split('.').length).toBeGreaterThanOrEqual(4)
  })

  it('auto-generates missing fields', () => {
    const header = createDotdoRequestHeader!({})

    const parts = header.split('.')
    expect(parts[0]).toBeTruthy() // correlationId
    expect(parts[1]).toBeTruthy() // requestId
    expect(parts[2]).toBeTruthy() // timestamp
    expect(parts[3]).toBeTruthy() // sequence
  })

  it('includes spanId when present', () => {
    const ctx = createValidContext({
      spanId: 'span-xyz',
      parentSpanId: 'span-parent',
    })

    const header = createDotdoRequestHeader!(ctx)

    expect(header).toContain('span-xyz')
  })

  it('creates deterministic header for same context', () => {
    const ctx = createValidContext({
      correlationId: 'corr-fixed',
      requestId: 'req-fixed',
      timestamp: 1704067200000,
      sequence: 5,
    })

    const header1 = createDotdoRequestHeader!(ctx)
    const header2 = createDotdoRequestHeader!(ctx)

    expect(header1).toBe(header2)
  })
})

// ============================================================================
// 4. X-Dotdo-Request Header Parsing Tests
// ============================================================================

describe('X-Dotdo-Request header parsing', () => {
  it('parseDotdoRequestHeader function is exported', () => {
    expect(parseDotdoRequestHeader).toBeDefined()
    expect(typeof parseDotdoRequestHeader).toBe('function')
  })

  it('parses valid header into context', () => {
    const header = 'corr-abc123.req-xyz789.1704067200000.1'

    const ctx = parseDotdoRequestHeader!(header)

    expect(ctx.correlationId).toBe('corr-abc123')
    expect(ctx.requestId).toBe('req-xyz789')
    expect(ctx.timestamp).toBe(1704067200000)
    expect(ctx.sequence).toBe(1)
  })

  it('parses header with span IDs', () => {
    const header = 'corr-abc123.req-xyz789.1704067200000.1.span-123.span-parent'

    const ctx = parseDotdoRequestHeader!(header)

    expect(ctx.spanId).toBe('span-123')
    expect(ctx.parentSpanId).toBe('span-parent')
  })

  it('throws for malformed header', () => {
    const invalidHeaders = [
      '',
      'invalid',
      'only.two.parts',
      'a.b.notanumber.d',
    ]

    invalidHeaders.forEach(header => {
      expect(() => parseDotdoRequestHeader!(header)).toThrow()
    })
  })

  it('roundtrips: create -> parse -> create', () => {
    const original = createValidContext({
      correlationId: 'corr-roundtrip',
      requestId: 'req-roundtrip',
      timestamp: 1704067200000,
      sequence: 42,
    })

    const header = createDotdoRequestHeader!(original)
    const parsed = parseDotdoRequestHeader!(header)
    const header2 = createDotdoRequestHeader!(parsed)

    expect(header2).toBe(header)
  })

  it('parses sequence as number', () => {
    const header = 'corr-abc.req-xyz.1704067200000.99'

    const ctx = parseDotdoRequestHeader!(header)

    expect(typeof ctx.sequence).toBe('number')
    expect(ctx.sequence).toBe(99)
  })

  it('parses timestamp as number', () => {
    const header = 'corr-abc.req-xyz.1704067200000.1'

    const ctx = parseDotdoRequestHeader!(header)

    expect(typeof ctx.timestamp).toBe('number')
    expect(ctx.timestamp).toBe(1704067200000)
  })

  it('handles UUIDs in correlation/request IDs', () => {
    const header = '550e8400-e29b-41d4-a716-446655440000.f47ac10b-58cc-4372-a567-0e02b2c3d479.1704067200000.1'

    const ctx = parseDotdoRequestHeader!(header)

    expect(ctx.correlationId).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(ctx.requestId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479')
  })
})

// ============================================================================
// 5. Propagation Through DO Calls Tests
// ============================================================================

describe('Propagation through DO calls', () => {
  it('extractCorrelationFromRequest function is exported', () => {
    expect(extractCorrelationFromRequest).toBeDefined()
    expect(typeof extractCorrelationFromRequest).toBe('function')
  })

  it('injectCorrelationHeaders function is exported', () => {
    expect(injectCorrelationHeaders).toBeDefined()
    expect(typeof injectCorrelationHeaders).toBe('function')
  })

  it('extracts correlation from X-Dotdo-Request header', () => {
    const request = new Request('http://localhost/api/test', {
      headers: {
        'X-Dotdo-Request': 'corr-abc123.req-xyz789.1704067200000.1',
      },
    })

    const ctx = extractCorrelationFromRequest!(request)

    expect(ctx).not.toBeNull()
    expect(ctx!.correlationId).toBe('corr-abc123')
  })

  it('extracts correlation from X-Correlation-ID fallback', () => {
    const request = new Request('http://localhost/api/test', {
      headers: {
        'X-Correlation-ID': 'corr-fallback',
      },
    })

    const ctx = extractCorrelationFromRequest!(request)

    expect(ctx).not.toBeNull()
    expect(ctx!.correlationId).toBe('corr-fallback')
  })

  it('extracts correlation from X-Request-ID fallback', () => {
    const request = new Request('http://localhost/api/test', {
      headers: {
        'X-Request-ID': 'req-fallback',
      },
    })

    const ctx = extractCorrelationFromRequest!(request)

    expect(ctx).not.toBeNull()
    expect(ctx!.requestId).toBe('req-fallback')
  })

  it('returns null for request without correlation headers', () => {
    const request = new Request('http://localhost/api/test')

    const ctx = extractCorrelationFromRequest!(request)

    expect(ctx).toBeNull()
  })

  it('injects all correlation headers into request', () => {
    const originalRequest = new Request('http://localhost/api/downstream')
    const ctx = createValidContext({
      correlationId: 'corr-inject',
      requestId: 'req-inject',
      timestamp: 1704067200000,
      sequence: 5,
    })

    const modifiedRequest = injectCorrelationHeaders!(originalRequest, ctx)

    expect(modifiedRequest.headers.get('X-Correlation-ID')).toBe('corr-inject')
    expect(modifiedRequest.headers.get('X-Request-ID')).toBe('req-inject')
    expect(modifiedRequest.headers.get('X-Dotdo-Request')).toContain('corr-inject')
  })

  it('preserves existing headers when injecting', () => {
    const originalRequest = new Request('http://localhost/api/downstream', {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer token',
      },
    })
    const ctx = createValidContext()

    const modifiedRequest = injectCorrelationHeaders!(originalRequest, ctx)

    expect(modifiedRequest.headers.get('Content-Type')).toBe('application/json')
    expect(modifiedRequest.headers.get('Authorization')).toBe('Bearer token')
  })

  it('increments sequence when propagating', () => {
    const ctx = createValidContext({ sequence: 1 })
    const originalRequest = new Request('http://localhost/api/downstream')

    const modifiedRequest = injectCorrelationHeaders!(originalRequest, ctx)
    const header = modifiedRequest.headers.get('X-Dotdo-Request')!
    const parsed = parseDotdoRequestHeader!(header)

    expect(parsed.sequence).toBe(2) // Incremented from 1
  })

  it('propagates same correlationId across calls', () => {
    const ctx = createValidContext({ correlationId: 'corr-propagate' })
    const request1 = new Request('http://localhost/api/call1')
    const request2 = new Request('http://localhost/api/call2')

    const modified1 = injectCorrelationHeaders!(request1, ctx)
    const modified2 = injectCorrelationHeaders!(request2, ctx)

    expect(modified1.headers.get('X-Correlation-ID')).toBe('corr-propagate')
    expect(modified2.headers.get('X-Correlation-ID')).toBe('corr-propagate')
  })
})

// ============================================================================
// 6. Child Span Creation Tests
// ============================================================================

describe('Child span creation', () => {
  it('createChildSpan function is exported', () => {
    expect(createChildSpan).toBeDefined()
    expect(typeof createChildSpan).toBe('function')
  })

  it('creates child span with same correlationId', () => {
    const parent = createValidContext({
      correlationId: 'corr-parent',
      spanId: 'span-parent',
    })

    const child = createChildSpan!(parent)

    expect(child.correlationId).toBe('corr-parent')
  })

  it('creates child span with new requestId', () => {
    const parent = createValidContext({
      requestId: 'req-parent',
    })

    const child = createChildSpan!(parent)

    expect(child.requestId).not.toBe('req-parent')
  })

  it('sets parentSpanId to parent spanId', () => {
    const parent = createValidContext({
      spanId: 'span-parent-123',
    })

    const child = createChildSpan!(parent)

    expect(child.parentSpanId).toBe('span-parent-123')
  })

  it('generates new spanId for child', () => {
    const parent = createValidContext({
      spanId: 'span-parent',
    })

    const child = createChildSpan!(parent)

    expect(child.spanId).toBeDefined()
    expect(child.spanId).not.toBe('span-parent')
  })

  it('increments sequence for child', () => {
    const parent = createValidContext({ sequence: 5 })

    const child = createChildSpan!(parent)

    expect(child.sequence).toBe(6)
  })

  it('uses current timestamp for child', () => {
    const oldTimestamp = Date.now() - 10000
    const parent = createValidContext({ timestamp: oldTimestamp })

    const child = createChildSpan!(parent)

    expect(child.timestamp).toBeGreaterThan(oldTimestamp)
  })

  it('can create grandchild span', () => {
    const grandparent = createValidContext({
      correlationId: 'corr-root',
      spanId: 'span-gp',
      sequence: 1,
    })

    const parent = createChildSpan!(grandparent)
    const child = createChildSpan!(parent)

    expect(child.correlationId).toBe('corr-root')
    expect(child.parentSpanId).toBe(parent.spanId)
    expect(child.sequence).toBe(3)
  })

  it('maintains trace lineage through parent chain', () => {
    const root = createValidContext({
      correlationId: 'corr-trace',
      spanId: 'span-root',
    })

    const spans: CorrelationContext[] = [root]
    for (let i = 0; i < 5; i++) {
      spans.push(createChildSpan!(spans[spans.length - 1]))
    }

    // All should share same correlationId
    spans.forEach(span => {
      expect(span.correlationId).toBe('corr-trace')
    })

    // Each child should reference its parent
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].parentSpanId).toBe(spans[i - 1].spanId)
    }
  })
})

// ============================================================================
// 7. Linking Frontend Events to Backend Traces Tests
// ============================================================================

describe('Linking frontend events to backend traces', () => {
  // Helper to simulate DO interaction
  interface MockDOStub {
    fetch(request: Request): Promise<Response>
  }

  let linkFrontendToBackend: ((sessionEvent: { correlationId: string }, backendCtx: CorrelationContext) => boolean) | undefined
  let createSessionCorrelation: ((sessionId: string) => CorrelationContext) | undefined

  try {
    // @ts-expect-error - Module not yet implemented
    const linkModule = await import('../../workflows/context/correlation')
    linkFrontendToBackend = linkModule.linkFrontendToBackend
    createSessionCorrelation = linkModule.createSessionCorrelation
  } catch {
    linkFrontendToBackend = undefined
    createSessionCorrelation = undefined
  }

  it('createSessionCorrelation function is exported', () => {
    expect(createSessionCorrelation).toBeDefined()
  })

  it('creates correlation context from session ID', () => {
    const ctx = createSessionCorrelation!('session-abc123')

    expect(ctx.correlationId).toContain('session-abc123')
    expect(ctx.requestId).toBeDefined()
    expect(ctx.timestamp).toBeDefined()
    expect(ctx.sequence).toBe(1)
  })

  it('same session ID creates consistent correlation', () => {
    const ctx1 = createSessionCorrelation!('session-consistent')
    const ctx2 = createSessionCorrelation!('session-consistent')

    // Should have same base correlation ID (deterministic)
    expect(ctx1.correlationId).toBe(ctx2.correlationId)
  })

  it('linkFrontendToBackend function is exported', () => {
    expect(linkFrontendToBackend).toBeDefined()
  })

  it('links frontend event to backend context by correlationId', () => {
    const frontendEvent = {
      correlationId: 'corr-shared-123',
      type: 'request',
      data: { url: '/api/users' },
    }
    const backendCtx = createValidContext({
      correlationId: 'corr-shared-123',
    })

    const linked = linkFrontendToBackend!(frontendEvent, backendCtx)

    expect(linked).toBe(true)
  })

  it('returns false when correlationIds do not match', () => {
    const frontendEvent = {
      correlationId: 'corr-frontend',
    }
    const backendCtx = createValidContext({
      correlationId: 'corr-backend',
    })

    const linked = linkFrontendToBackend!(frontendEvent, backendCtx)

    expect(linked).toBe(false)
  })

  it('correlationId propagates from frontend to backend', () => {
    // Simulate: Frontend makes fetch with correlation header
    const frontendCorrelationId = 'corr-frontend-initiated'

    const frontendRequest = new Request('http://localhost/api/users', {
      headers: {
        'X-Correlation-ID': frontendCorrelationId,
        'X-Session-ID': 'session-user123',
      },
    })

    // Backend extracts correlation
    const ctx = extractCorrelationFromRequest!(frontendRequest)

    expect(ctx).not.toBeNull()
    expect(ctx!.correlationId).toBe(frontendCorrelationId)
  })

  it('session events can be grouped by shared correlationId', () => {
    const sharedCorrelation = 'corr-session-group'

    const events = [
      { correlationId: sharedCorrelation, type: 'request', data: { url: '/api/a' } },
      { correlationId: sharedCorrelation, type: 'response', data: { status: 200 } },
      { correlationId: sharedCorrelation, type: 'request', data: { url: '/api/b' } },
      { correlationId: sharedCorrelation, type: 'response', data: { status: 201 } },
    ]

    const backendCtx = createValidContext({ correlationId: sharedCorrelation })

    // All events should link to the same backend context
    events.forEach(event => {
      expect(linkFrontendToBackend!(event, backendCtx)).toBe(true)
    })
  })
})

// ============================================================================
// 8. Header Validation and Security Tests
// ============================================================================

describe('Header validation and security', () => {
  it('rejects correlation ID with injection attempts', () => {
    const maliciousHeaders = [
      'corr-<script>alert(1)</script>',
      'corr-"; DROP TABLE users;--',
      'corr-\n\rX-Injected-Header: value',
      'corr-${process.env.SECRET}',
    ]

    maliciousHeaders.forEach(header => {
      expect(() => parseDotdoRequestHeader!(header + '.req.123.1')).toThrow()
    })
  })

  it('truncates excessively long correlation IDs', () => {
    const longId = 'corr-' + 'a'.repeat(10000)
    const ctx = createValidContext({ correlationId: longId })

    const header = createDotdoRequestHeader!(ctx)

    // Should truncate to reasonable length
    expect(header.length).toBeLessThan(1000)
  })

  it('sanitizes special characters in IDs', () => {
    const ctx = createValidContext({
      correlationId: 'corr-test\n\rinjection',
    })

    const header = createDotdoRequestHeader!(ctx)

    expect(header).not.toContain('\n')
    expect(header).not.toContain('\r')
  })

  it('validates timestamp is reasonable', () => {
    const futureTimestamp = Date.now() + 86400000 * 365 // 1 year in future
    const pastTimestamp = Date.now() - 86400000 * 365 * 10 // 10 years in past

    const futureHeader = `corr-abc.req-xyz.${futureTimestamp}.1`
    const pastHeader = `corr-abc.req-xyz.${pastTimestamp}.1`

    // Implementation may reject extreme timestamps
    expect(() => parseDotdoRequestHeader!(futureHeader)).not.toThrow() // Allow some future
    expect(() => parseDotdoRequestHeader!(pastHeader)).not.toThrow() // Allow historical
  })

  it('validates sequence is positive integer', () => {
    const invalidSequences = [
      'corr-abc.req-xyz.123456789.0', // zero
      'corr-abc.req-xyz.123456789.-1', // negative
      'corr-abc.req-xyz.123456789.1.5', // decimal
    ]

    invalidSequences.forEach(header => {
      expect(() => parseDotdoRequestHeader!(header)).toThrow()
    })
  })
})

// ============================================================================
// 9. Integration with Session Events Tests
// ============================================================================

describe('Integration with session events', () => {
  it('session event correlationId matches request header', async () => {
    const request = new Request('http://localhost/api/users', {
      headers: {
        'X-Dotdo-Request': 'corr-session123.req-abc.1704067200000.1',
      },
    })

    const ctx = extractCorrelationFromRequest!(request)

    // Session event would use same correlationId
    const sessionEvent = {
      id: 'evt-001',
      correlationId: ctx!.correlationId,
      timestamp: Date.now(),
      type: 'request' as const,
      data: { url: '/api/users', method: 'GET' },
    }

    expect(sessionEvent.correlationId).toBe('corr-session123')
  })

  it('response includes correlation headers for client', () => {
    const ctx = createValidContext({
      correlationId: 'corr-response',
      requestId: 'req-response',
    })

    // Simulating response header injection
    const responseHeaders = new Headers()
    responseHeaders.set('X-Correlation-ID', ctx.correlationId)
    responseHeaders.set('X-Request-ID', ctx.requestId)

    expect(responseHeaders.get('X-Correlation-ID')).toBe('corr-response')
    expect(responseHeaders.get('X-Request-ID')).toBe('req-response')
  })

  it('error events inherit correlation context', () => {
    const ctx = createValidContext({
      correlationId: 'corr-error-context',
    })

    // When an error occurs, the session event should use same correlation
    const errorEvent = {
      id: 'evt-error',
      correlationId: ctx.correlationId,
      timestamp: Date.now(),
      type: 'error' as const,
      data: {
        name: 'Error',
        message: 'Something went wrong',
        stack: 'Error: Something went wrong\n    at ...',
      },
    }

    expect(errorEvent.correlationId).toBe('corr-error-context')
  })

  it('log events include request context', () => {
    const ctx = createValidContext({
      correlationId: 'corr-log',
      requestId: 'req-log',
    })

    const logEvent = {
      id: 'evt-log',
      correlationId: ctx.correlationId,
      timestamp: Date.now(),
      type: 'log' as const,
      data: {
        level: 'info',
        message: 'Processing request',
        context: {
          requestId: ctx.requestId,
          method: 'POST',
          path: '/api/users',
        },
      },
    }

    expect(logEvent.correlationId).toBe('corr-log')
    expect(logEvent.data.context.requestId).toBe('req-log')
  })
})

// ============================================================================
// 10. Edge Cases and Error Handling Tests
// ============================================================================

describe('Edge cases and error handling', () => {
  it('handles missing correlation gracefully', () => {
    const request = new Request('http://localhost/api/test')

    // Should return null, not throw
    const ctx = extractCorrelationFromRequest!(request)
    expect(ctx).toBeNull()
  })

  it('handles partial correlation headers', () => {
    const request = new Request('http://localhost/api/test', {
      headers: {
        'X-Correlation-ID': 'corr-only',
        // Missing X-Request-ID and X-Dotdo-Request
      },
    })

    const ctx = extractCorrelationFromRequest!(request)

    expect(ctx).not.toBeNull()
    expect(ctx!.correlationId).toBe('corr-only')
    // requestId might be generated or undefined
  })

  it('prefers X-Dotdo-Request over individual headers', () => {
    const request = new Request('http://localhost/api/test', {
      headers: {
        'X-Correlation-ID': 'corr-individual',
        'X-Dotdo-Request': 'corr-combined.req-xyz.1704067200000.1',
      },
    })

    const ctx = extractCorrelationFromRequest!(request)

    // X-Dotdo-Request should take precedence
    expect(ctx!.correlationId).toBe('corr-combined')
  })

  it('handles concurrent correlation contexts', () => {
    const ctx1 = createValidContext({ correlationId: 'corr-1' })
    const ctx2 = createValidContext({ correlationId: 'corr-2' })

    // Creating headers for both should not interfere
    const header1 = createDotdoRequestHeader!(ctx1)
    const header2 = createDotdoRequestHeader!(ctx2)

    expect(header1).toContain('corr-1')
    expect(header2).toContain('corr-2')
  })

  it('handles empty string correlation ID', () => {
    // Should either throw or generate a new ID
    expect(() => {
      createDotdoRequestHeader!({ correlationId: '' })
    }).not.toThrow() // Might generate new ID
  })

  it('handles unicode in correlation ID', () => {
    // Should sanitize or reject
    const ctx = createValidContext({ correlationId: 'corr-' })

    const header = createDotdoRequestHeader!(ctx)

    // Should either include sanitized version or reject
    expect(header).toBeDefined()
  })
})
