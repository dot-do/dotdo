/**
 * Sample Event Fixtures for E2E Pipeline Tests
 *
 * Provides test fixtures for unified events across different event types.
 * These fixtures are used to test the end-to-end event pipeline:
 * StreamBridge -> Hot Tier Storage -> Query
 *
 * @module tests/e2e/fixtures/sample-events
 */

import type { UnifiedEvent } from '../../../types/unified-event'
import { createUnifiedEvent } from '../../../types/unified-event'

// ============================================================================
// TRACE EVENTS - Distributed tracing events
// ============================================================================

/**
 * Sample HTTP request trace event
 */
export function createSampleHttpRequest(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `trace-http-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'trace',
    event_name: 'http.request',
    ns: 'https://api.example.com',
    trace_id: `trace-${Date.now()}`,
    span_id: `span-${Date.now()}`,
    http_method: 'GET',
    http_url: '/api/users',
    http_status: 200,
    duration_ms: 45,
    outcome: 'ok',
    service_name: 'api-gateway',
    ...overrides,
  })
}

/**
 * Sample database query trace event
 */
export function createSampleDbQuery(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `trace-db-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'trace',
    event_name: 'db.query',
    ns: 'https://api.example.com',
    trace_id: `trace-${Date.now()}`,
    span_id: `span-${Date.now()}`,
    duration_ms: 12,
    outcome: 'ok',
    service_name: 'user-service',
    data: { query: 'SELECT * FROM users WHERE id = ?', table: 'users' },
    ...overrides,
  })
}

// ============================================================================
// LOG EVENTS - Application logging events
// ============================================================================

/**
 * Sample error log event
 */
export function createSampleErrorLog(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'log',
    event_name: 'app.error',
    ns: 'https://api.example.com',
    log_level: 'error',
    log_message: 'Connection to database failed after 3 retries',
    service_name: 'api-gateway',
    data: {
      error_type: 'DatabaseConnectionError',
      retry_count: 3,
      host: 'db.example.com',
    },
    ...overrides,
  })
}

/**
 * Sample info log event
 */
export function createSampleInfoLog(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'log',
    event_name: 'app.info',
    ns: 'https://api.example.com',
    log_level: 'info',
    log_message: 'User authentication successful',
    service_name: 'auth-service',
    actor_id: 'user-123',
    ...overrides,
  })
}

// ============================================================================
// METRIC EVENTS - Application metrics
// ============================================================================

/**
 * Sample request count metric
 */
export function createSampleMetric(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `metric-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'metric',
    event_name: 'request.count',
    ns: 'https://api.example.com',
    service_name: 'web-server',
    data: {
      value: 100,
      unit: 'requests',
      tags: { endpoint: '/api/users', method: 'GET' },
    },
    ...overrides,
  })
}

/**
 * Sample latency metric
 */
export function createSampleLatencyMetric(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `metric-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'metric',
    event_name: 'request.latency',
    ns: 'https://api.example.com',
    service_name: 'api-gateway',
    duration_ms: 125,
    data: {
      p50: 45,
      p95: 120,
      p99: 250,
    },
    ...overrides,
  })
}

// ============================================================================
// VITAL EVENTS - Web vitals
// ============================================================================

/**
 * Sample LCP vital event
 */
export function createSampleLcpVital(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `vital-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'vital',
    event_name: 'web-vital',
    ns: 'https://app.example.com',
    vital_name: 'LCP',
    vital_value: 2500,
    vital_rating: 'good',
    session_id: `session-${Date.now()}`,
    ...overrides,
  })
}

/**
 * Sample FID vital event
 */
export function createSampleFidVital(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `vital-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'vital',
    event_name: 'web-vital',
    ns: 'https://app.example.com',
    vital_name: 'FID',
    vital_value: 50,
    vital_rating: 'good',
    session_id: `session-${Date.now()}`,
    ...overrides,
  })
}

/**
 * Sample CLS vital event
 */
export function createSampleClsVital(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `vital-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'vital',
    event_name: 'web-vital',
    ns: 'https://app.example.com',
    vital_name: 'CLS',
    vital_value: 0.05,
    vital_rating: 'good',
    session_id: `session-${Date.now()}`,
    ...overrides,
  })
}

// ============================================================================
// TRACK EVENTS - User analytics
// ============================================================================

/**
 * Sample user signup event
 */
export function createSampleSignupTrack(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'track',
    event_name: 'user.signup',
    ns: 'https://app.example.com',
    actor_id: `user-${Date.now()}`,
    data: { plan: 'pro', source: 'google' },
    properties: { referrer: 'google.com', campaign: 'summer2024' },
    ...overrides,
  })
}

/**
 * Sample purchase event
 */
export function createSamplePurchaseTrack(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'track',
    event_name: 'purchase.completed',
    ns: 'https://app.example.com',
    actor_id: `user-${Date.now()}`,
    data: {
      orderId: `order-${Date.now()}`,
      amount: 99.99,
      currency: 'USD',
      items: [{ sku: 'SKU-001', quantity: 1 }],
    },
    ...overrides,
  })
}

// ============================================================================
// PAGE EVENTS - Page view tracking
// ============================================================================

/**
 * Sample page view event
 */
export function createSamplePageView(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return createUnifiedEvent({
    id: `page-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    event_type: 'page',
    event_name: 'page.view',
    ns: 'https://app.example.com',
    http_url: '/dashboard',
    session_id: `session-${Date.now()}`,
    actor_id: `user-${Date.now()}`,
    properties: {
      title: 'Dashboard',
      referrer: 'https://app.example.com/home',
    },
    ...overrides,
  })
}

// ============================================================================
// BATCH GENERATORS - Generate multiple related events
// ============================================================================

/**
 * Create a batch of events with the same trace_id
 * Useful for testing correlation queries
 */
export function createTraceBatch(traceId: string, count: number = 5): UnifiedEvent[] {
  const events: UnifiedEvent[] = []

  // Parent span
  const parentSpanId = `span-root-${Date.now()}`
  events.push(
    createSampleHttpRequest({
      trace_id: traceId,
      span_id: parentSpanId,
      parent_id: null,
      event_name: 'http.server',
    })
  )

  // Child spans
  for (let i = 1; i < count; i++) {
    const spanId = `span-child-${i}-${Date.now()}`
    events.push(
      createSampleDbQuery({
        trace_id: traceId,
        span_id: spanId,
        parent_id: parentSpanId,
        event_name: `db.query.${i}`,
      })
    )
  }

  return events
}

/**
 * Create a batch of events with the same session_id
 * Useful for testing session correlation queries
 */
export function createSessionBatch(sessionId: string, count: number = 5): UnifiedEvent[] {
  const events: UnifiedEvent[] = []
  const userId = `user-${Date.now()}`

  // Initial page view
  events.push(
    createSamplePageView({
      session_id: sessionId,
      actor_id: userId,
      http_url: '/home',
    })
  )

  // Navigation events
  for (let i = 1; i < count - 1; i++) {
    events.push(
      createSamplePageView({
        session_id: sessionId,
        actor_id: userId,
        http_url: `/page-${i}`,
      })
    )
  }

  // Conversion event
  events.push(
    createSampleSignupTrack({
      session_id: sessionId,
      actor_id: userId,
    })
  )

  return events
}

/**
 * Create a mixed batch of different event types
 * Useful for testing type filtering
 */
export function createMixedBatch(count: number = 10): UnifiedEvent[] {
  const events: UnifiedEvent[] = []
  const sessionId = `session-${Date.now()}`
  const traceId = `trace-${Date.now()}`

  // Add 2 of each type
  events.push(createSampleHttpRequest({ trace_id: traceId }))
  events.push(createSampleDbQuery({ trace_id: traceId }))
  events.push(createSampleErrorLog())
  events.push(createSampleInfoLog())
  events.push(createSampleMetric())
  events.push(createSampleLatencyMetric())
  events.push(createSampleLcpVital({ session_id: sessionId }))
  events.push(createSampleFidVital({ session_id: sessionId }))
  events.push(createSampleSignupTrack({ session_id: sessionId }))
  events.push(createSamplePageView({ session_id: sessionId }))

  return events.slice(0, count)
}

// ============================================================================
// CORRELATION IDS - For testing correlation queries
// ============================================================================

/**
 * Generate a unique trace ID
 */
export function generateTraceId(): string {
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Generate a unique correlation ID
 */
export function generateCorrelationId(): string {
  return `corr-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}
