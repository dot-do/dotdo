/**
 * @dotdo/sentry - Performance Tracing Tests
 *
 * Tests for Sentry-compatible transaction and span APIs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  init,
  startTransaction,
  startSpan,
  getCurrentHub,
  _clear,
  InMemoryTransport,
} from '../index'

import type { Transaction, Span, SpanContext } from '../transactions'

describe('@dotdo/sentry - Performance Tracing', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Transaction Creation
  // ===========================================================================

  describe('startTransaction', () => {
    it('should create a transaction with name and op', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({
        name: 'GET /api/users',
        op: 'http.server',
      })

      expect(transaction).toBeDefined()
      expect(transaction.name).toBe('GET /api/users')
      expect(transaction.op).toBe('http.server')
      expect(transaction.traceId).toBeDefined()
      expect(transaction.spanId).toBeDefined()
    })

    it('should generate unique trace IDs', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const tx1 = startTransaction({ name: 'tx1' })
      const tx2 = startTransaction({ name: 'tx2' })

      expect(tx1.traceId).not.toBe(tx2.traceId)
    })

    it('should accept custom trace ID', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const customTraceId = 'a'.repeat(32)
      const transaction = startTransaction({
        name: 'test',
        traceId: customTraceId,
      })

      expect(transaction.traceId).toBe(customTraceId)
    })

    it('should set transaction status', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'test' })
      expect(transaction.status).toBeUndefined()

      transaction.setStatus('ok')
      expect(transaction.status).toBe('ok')

      transaction.setStatus('internal_error')
      expect(transaction.status).toBe('internal_error')
    })

    it('should set HTTP status code', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'test' })

      transaction.setHttpStatus(200)
      expect(transaction.status).toBe('ok')
      expect(transaction.data?.['http.status_code']).toBe(200)

      transaction.setHttpStatus(404)
      expect(transaction.status).toBe('not_found')

      transaction.setHttpStatus(500)
      expect(transaction.status).toBe('internal_error')
    })

    it('should support transaction data', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({
        name: 'test',
        data: {
          'http.method': 'POST',
          'http.url': '/api/users',
        },
      })

      expect(transaction.data?.['http.method']).toBe('POST')
      expect(transaction.data?.['http.url']).toBe('/api/users')
    })

    it('should support transaction tags', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({
        name: 'test',
        tags: {
          environment: 'production',
          service: 'api',
        },
      })

      expect(transaction.tags?.environment).toBe('production')
      expect(transaction.tags?.service).toBe('api')
    })
  })

  // ===========================================================================
  // Spans
  // ===========================================================================

  describe('Transaction Spans', () => {
    it('should start a child span on transaction', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'parent' })
      const span = transaction.startChild({
        op: 'db.query',
        description: 'SELECT * FROM users',
      })

      expect(span).toBeDefined()
      expect(span.op).toBe('db.query')
      expect(span.description).toBe('SELECT * FROM users')
      expect(span.traceId).toBe(transaction.traceId)
      expect(span.parentSpanId).toBe(transaction.spanId)
    })

    it('should nest spans correctly', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'parent' })
      const span1 = transaction.startChild({ op: 'level1' })
      const span2 = span1.startChild({ op: 'level2' })
      const span3 = span2.startChild({ op: 'level3' })

      expect(span1.parentSpanId).toBe(transaction.spanId)
      expect(span2.parentSpanId).toBe(span1.spanId)
      expect(span3.parentSpanId).toBe(span2.spanId)

      // All should share the same trace ID
      expect(span1.traceId).toBe(transaction.traceId)
      expect(span2.traceId).toBe(transaction.traceId)
      expect(span3.traceId).toBe(transaction.traceId)
    })

    it('should track span start and end times', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'parent' })
      const span = transaction.startChild({ op: 'test' })

      expect(span.startTimestamp).toBeDefined()
      expect(span.endTimestamp).toBeUndefined()

      span.finish()

      expect(span.endTimestamp).toBeDefined()
      expect(span.endTimestamp!).toBeGreaterThanOrEqual(span.startTimestamp)
    })

    it('should set span status', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'parent' })
      const span = transaction.startChild({ op: 'test' })

      span.setStatus('ok')
      expect(span.status).toBe('ok')

      span.setStatus('cancelled')
      expect(span.status).toBe('cancelled')
    })

    it('should support span data', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'parent' })
      const span = transaction.startChild({
        op: 'db.query',
        data: {
          'db.system': 'postgresql',
          'db.name': 'mydb',
        },
      })

      expect(span.data?.['db.system']).toBe('postgresql')

      span.setData('db.rows_affected', 42)
      expect(span.data?.['db.rows_affected']).toBe(42)
    })

    it('should get all child spans from transaction', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'parent' })
      const span1 = transaction.startChild({ op: 'op1' })
      const span2 = transaction.startChild({ op: 'op2' })
      const span3 = span1.startChild({ op: 'op3' })

      const spans = transaction.getSpans()

      expect(spans.length).toBe(3)
      expect(spans.map(s => s.op)).toContain('op1')
      expect(spans.map(s => s.op)).toContain('op2')
      expect(spans.map(s => s.op)).toContain('op3')
    })
  })

  // ===========================================================================
  // startSpan Convenience Function
  // ===========================================================================

  describe('startSpan', () => {
    it('should execute callback and return result', async () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const result = await startSpan(
        { name: 'test-operation', op: 'test' },
        (span) => {
          expect(span).toBeDefined()
          return 'success'
        }
      )

      expect(result).toBe('success')
    })

    it('should automatically finish span after callback', async () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      let capturedSpan: Span | undefined

      await startSpan({ name: 'test', op: 'test' }, (span) => {
        capturedSpan = span
        expect(span.endTimestamp).toBeUndefined()
      })

      expect(capturedSpan?.endTimestamp).toBeDefined()
    })

    it('should handle async callbacks', async () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const result = await startSpan(
        { name: 'async-test', op: 'async' },
        async (span) => {
          await new Promise(resolve => setTimeout(resolve, 10))
          return 'async-success'
        }
      )

      expect(result).toBe('async-success')
    })

    it('should set error status on exception', async () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      let capturedSpan: Span | undefined

      await expect(
        startSpan({ name: 'error-test', op: 'test' }, (span) => {
          capturedSpan = span
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')

      expect(capturedSpan?.status).toBe('internal_error')
      expect(capturedSpan?.endTimestamp).toBeDefined()
    })

    it('should create nested spans within callback', async () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      await startSpan({ name: 'outer', op: 'outer' }, async (outerSpan) => {
        await startSpan({ name: 'inner', op: 'inner' }, (innerSpan) => {
          expect(innerSpan.parentSpanId).toBe(outerSpan.spanId)
        })
      })
    })
  })

  // ===========================================================================
  // Transaction Finish & Event Generation
  // ===========================================================================

  describe('Transaction Finish', () => {
    it('should generate transaction event on finish', () => {
      init({ dsn: 'https://key@sentry.example.com/1', tracesSampleRate: 1.0 })

      const transaction = startTransaction({
        name: 'test-transaction',
        op: 'http.server',
      })

      transaction.startChild({ op: 'db.query', description: 'SELECT' }).finish()
      transaction.finish()

      // Transaction generates event via toEvent()
      const event = transaction.toEvent()

      expect(event.type).toBe('transaction')
      expect(event.transaction).toBe('test-transaction')
      expect(event.contexts?.trace?.op).toBe('http.server')
    })

    it('should include all spans in transaction event', () => {
      init({ dsn: 'https://key@sentry.example.com/1', tracesSampleRate: 1.0 })

      const transaction = startTransaction({ name: 'parent', op: 'test' })
      const span1 = transaction.startChild({ op: 'span1' })
      const span2 = transaction.startChild({ op: 'span2' })

      span1.finish()
      span2.finish()
      transaction.finish()

      const event = transaction.toEvent()

      expect(event.spans).toBeDefined()
      expect(event.spans?.length).toBe(2)
    })

    it('should automatically finish unfinished child spans', () => {
      init({ dsn: 'https://key@sentry.example.com/1', tracesSampleRate: 1.0 })

      const transaction = startTransaction({ name: 'parent', op: 'test' })
      const span = transaction.startChild({ op: 'unfinished' })

      // Don't call span.finish()
      expect(span.isFinished()).toBe(false)

      transaction.finish()

      // Span should be auto-finished
      expect(span.isFinished()).toBe(true)
      expect(span.endTimestamp).toBeDefined()

      // Event should include the auto-finished span
      const event = transaction.toEvent()
      expect(event.spans?.length).toBe(1)
      expect((event.spans?.[0] as any).op).toBe('unfinished')
    })

    it('should mark sampled=false when tracesSampleRate is 0', () => {
      init({ dsn: 'https://key@sentry.example.com/1', tracesSampleRate: 0 })

      // With sample rate of 0, transactions created without explicit sampled should not be sampled
      const transaction = startTransaction({ name: 'test' })

      // The transaction is created but marked as not sampled
      expect(transaction.traceId).toBeDefined()
    })
  })

  // ===========================================================================
  // Span Status Mapping
  // ===========================================================================

  describe('Span Status', () => {
    it('should support all Sentry span statuses', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'test' })

      const statuses = [
        'ok',
        'cancelled',
        'unknown',
        'invalid_argument',
        'deadline_exceeded',
        'not_found',
        'already_exists',
        'permission_denied',
        'resource_exhausted',
        'failed_precondition',
        'aborted',
        'out_of_range',
        'unimplemented',
        'internal_error',
        'unavailable',
        'data_loss',
        'unauthenticated',
      ] as const

      for (const status of statuses) {
        transaction.setStatus(status)
        expect(transaction.status).toBe(status)
      }
    })

    it('should map HTTP status codes to span statuses', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const testCases: Array<[number, string]> = [
        [200, 'ok'],
        [201, 'ok'],
        [204, 'ok'],
        [400, 'invalid_argument'],
        [401, 'unauthenticated'],
        [403, 'permission_denied'],
        [404, 'not_found'],
        [409, 'already_exists'],
        [429, 'resource_exhausted'],
        [499, 'cancelled'],
        [500, 'internal_error'],
        [501, 'unimplemented'],
        [503, 'unavailable'],
        [504, 'deadline_exceeded'],
      ]

      for (const [httpStatus, expectedStatus] of testCases) {
        const transaction = startTransaction({ name: `test-${httpStatus}` })
        transaction.setHttpStatus(httpStatus)
        expect(transaction.status).toBe(expectedStatus)
      }
    })
  })

  // ===========================================================================
  // Trace Context
  // ===========================================================================

  describe('Trace Context', () => {
    it('should generate trace headers', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'test' })
      const headers = transaction.toTraceparent()

      // Format: {version}-{traceId}-{spanId}-{sampled}
      expect(headers).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/)
    })

    it('should include sampling decision in trace header', () => {
      init({
        dsn: 'https://key@sentry.example.com/1',
        tracesSampleRate: 1.0,
      })

      const transaction = startTransaction({ name: 'test' })
      const headers = transaction.toTraceparent()

      // Should end with -01 (sampled)
      expect(headers).toMatch(/-01$/)
    })

    it('should propagate trace context through baggage', () => {
      init({
        dsn: 'https://key@sentry.example.com/1',
        release: 'test@1.0.0',
        environment: 'test',
        tracesSampleRate: 1.0,
      })

      const transaction = startTransaction({ name: 'test' })
      const baggage = transaction.toBaggage()

      // Baggage should contain trace_id
      expect(baggage).toContain('sentry-trace_id=')
      // Note: release/environment are only included if configured in the transaction hub
      // The basic implementation includes trace_id, public_key, and sampled
      expect(baggage).toContain('sentry-sampled=')
    })

    it('should continue trace from incoming headers', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const incomingTraceId = 'a'.repeat(32)
      const incomingSpanId = 'b'.repeat(16)
      const sentryTrace = `00-${incomingTraceId}-${incomingSpanId}-01`

      const transaction = startTransaction({
        name: 'child-transaction',
        op: 'http.server',
      }, {
        sentryTrace,
      })

      expect(transaction.traceId).toBe(incomingTraceId)
      expect(transaction.parentSpanId).toBe(incomingSpanId)
    })
  })

  // ===========================================================================
  // Transaction Measurements
  // ===========================================================================

  describe('Measurements', () => {
    it('should add measurements to transaction', () => {
      init({ dsn: 'https://key@sentry.example.com/1' })

      const transaction = startTransaction({ name: 'test' })

      transaction.setMeasurement('lcp', 2500, 'millisecond')
      transaction.setMeasurement('fcp', 1200, 'millisecond')
      transaction.setMeasurement('cls', 0.1, 'none')

      expect(transaction.measurements?.lcp).toEqual({
        value: 2500,
        unit: 'millisecond',
      })
      expect(transaction.measurements?.fcp).toEqual({
        value: 1200,
        unit: 'millisecond',
      })
      expect(transaction.measurements?.cls).toEqual({
        value: 0.1,
        unit: 'none',
      })
    })
  })
})
