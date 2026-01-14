/**
 * Trigger Observability Tests
 *
 * Comprehensive tests for trigger observability including:
 * - Metric collection (fire counts, latency, errors)
 * - Fire rate tracking with sliding window
 * - Latency histograms with percentiles
 * - Error rate monitoring
 * - Tracing integration with span context propagation
 * - Alert thresholds and callbacks
 *
 * @module db/primitives/triggers/tests/observability.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  // Factory functions
  createTriggerObserver,
  createTriggerMetrics,
  createTriggerTracer,
  // Main classes
  TriggerObserver,
  TriggerMetrics,
  TriggerTracer,
  // Types
  type TriggerObserverOptions,
  type TriggerExecutionContext,
  type TriggerMetricEvent,
  type TriggerStats,
  type FireRateWindow,
  type LatencyHistogram,
  type AlertThreshold,
  type AlertCallback,
  type TriggerSpan,
  type SpanContext,
  // Metric names
  TriggerMetricNames,
  // Helper functions
  calculateP50,
  calculateP95,
  calculateP99,
} from '../observability'
import type { MetricsCollector } from '../../observability'
import { TestMetricsCollector } from '../../observability'

// ============================================================================
// TRIGGER METRICS TESTS
// ============================================================================

describe('TriggerMetrics', () => {
  let metrics: TriggerMetrics

  beforeEach(() => {
    metrics = createTriggerMetrics()
  })

  describe('Fire Count Tracking', () => {
    it('should track trigger fire count', () => {
      metrics.recordTriggerFired('webhook-github')
      metrics.recordTriggerFired('webhook-github')
      metrics.recordTriggerFired('webhook-github')

      const stats = metrics.getStats('webhook-github')
      expect(stats.fireCount).toBe(3)
    })

    it('should track fire count per trigger type', () => {
      metrics.recordTriggerFired('webhook-github')
      metrics.recordTriggerFired('webhook-stripe')
      metrics.recordTriggerFired('polling-api')

      expect(metrics.getStats('webhook-github').fireCount).toBe(1)
      expect(metrics.getStats('webhook-stripe').fireCount).toBe(1)
      expect(metrics.getStats('polling-api').fireCount).toBe(1)
    })

    it('should track last fire timestamp', () => {
      const before = Date.now()
      metrics.recordTriggerFired('webhook-github')
      const after = Date.now()

      const stats = metrics.getStats('webhook-github')
      expect(stats.lastFiredAt).toBeGreaterThanOrEqual(before)
      expect(stats.lastFiredAt).toBeLessThanOrEqual(after)
    })
  })

  describe('Success/Failure Tracking', () => {
    it('should track successful executions', () => {
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerSuccess('webhook-github', 150)

      const stats = metrics.getStats('webhook-github')
      expect(stats.successCount).toBe(2)
    })

    it('should track failed executions', () => {
      metrics.recordTriggerFailure('webhook-github', new Error('Handler failed'))
      metrics.recordTriggerFailure('webhook-github', new Error('Timeout'))

      const stats = metrics.getStats('webhook-github')
      expect(stats.failureCount).toBe(2)
    })

    it('should calculate success rate', () => {
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))

      const stats = metrics.getStats('webhook-github')
      expect(stats.successRate).toBe(0.75) // 3/4
    })

    it('should return 0 success rate when no executions', () => {
      const stats = metrics.getStats('nonexistent')
      expect(stats.successRate).toBe(0)
    })
  })

  describe('Latency Tracking', () => {
    it('should track execution latency', () => {
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerSuccess('webhook-github', 200)
      metrics.recordTriggerSuccess('webhook-github', 150)

      const stats = metrics.getStats('webhook-github')
      expect(stats.avgLatencyMs).toBe(150)
    })

    it('should track min/max latency', () => {
      metrics.recordTriggerSuccess('webhook-github', 50)
      metrics.recordTriggerSuccess('webhook-github', 200)
      metrics.recordTriggerSuccess('webhook-github', 100)

      const stats = metrics.getStats('webhook-github')
      expect(stats.minLatencyMs).toBe(50)
      expect(stats.maxLatencyMs).toBe(200)
    })

    it('should calculate latency percentiles', () => {
      // Add 100 samples for percentile accuracy
      for (let i = 1; i <= 100; i++) {
        metrics.recordTriggerSuccess('webhook-github', i)
      }

      const histogram = metrics.getLatencyHistogram('webhook-github')
      expect(histogram.p50).toBeGreaterThanOrEqual(49)
      expect(histogram.p50).toBeLessThanOrEqual(51)
      expect(histogram.p95).toBeGreaterThanOrEqual(94)
      expect(histogram.p95).toBeLessThanOrEqual(96)
      expect(histogram.p99).toBeGreaterThanOrEqual(98)
      expect(histogram.p99).toBeLessThanOrEqual(100)
    })
  })

  describe('Fire Rate Tracking', () => {
    it('should calculate fire rate per second', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      // Fire 10 times in 1 second
      for (let i = 0; i < 10; i++) {
        metrics.recordTriggerFired('webhook-github')
      }

      const rateWindow = metrics.getFireRate('webhook-github', { windowMs: 1000 })
      expect(rateWindow.ratePerSecond).toBe(10)

      vi.useRealTimers()
    })

    it('should calculate fire rate over sliding window', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      // Fire at different times
      metrics.recordTriggerFired('webhook-github')
      vi.advanceTimersByTime(500)
      metrics.recordTriggerFired('webhook-github')
      vi.advanceTimersByTime(500)
      metrics.recordTriggerFired('webhook-github')

      // 3 fires in ~1 second = 3/sec rate
      const rateWindow = metrics.getFireRate('webhook-github', { windowMs: 1000 })
      expect(rateWindow.count).toBe(3)
      expect(rateWindow.ratePerSecond).toBeCloseTo(3, 0)

      vi.useRealTimers()
    })

    it('should expire old events from fire rate window', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      // Fire 5 times
      for (let i = 0; i < 5; i++) {
        metrics.recordTriggerFired('webhook-github')
      }

      // Move past the window
      vi.advanceTimersByTime(2000)

      // Fire 2 more times
      metrics.recordTriggerFired('webhook-github')
      metrics.recordTriggerFired('webhook-github')

      const rateWindow = metrics.getFireRate('webhook-github', { windowMs: 1000 })
      expect(rateWindow.count).toBe(2) // Only the recent 2

      vi.useRealTimers()
    })
  })

  describe('Error Tracking', () => {
    it('should track last error', () => {
      const error = new Error('Connection refused')
      metrics.recordTriggerFailure('webhook-github', error)

      const stats = metrics.getStats('webhook-github')
      expect(stats.lastError).toBe(error)
    })

    it('should track error types', () => {
      metrics.recordTriggerFailure('webhook-github', new Error('Timeout'))
      metrics.recordTriggerFailure('webhook-github', new TypeError('Invalid type'))
      metrics.recordTriggerFailure('webhook-github', new Error('Timeout'))

      const errorBreakdown = metrics.getErrorBreakdown('webhook-github')
      expect(errorBreakdown['Error']).toBe(2)
      expect(errorBreakdown['TypeError']).toBe(1)
    })

    it('should calculate error rate', () => {
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))

      const stats = metrics.getStats('webhook-github')
      expect(stats.errorRate).toBe(0.5) // 2/4
    })
  })

  describe('Metrics Reset', () => {
    it('should reset all metrics', () => {
      metrics.recordTriggerFired('webhook-github')
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))

      metrics.reset()

      const stats = metrics.getStats('webhook-github')
      expect(stats.fireCount).toBe(0)
      expect(stats.successCount).toBe(0)
      expect(stats.failureCount).toBe(0)
    })

    it('should reset metrics for specific trigger', () => {
      metrics.recordTriggerFired('webhook-github')
      metrics.recordTriggerFired('webhook-stripe')

      metrics.resetTrigger('webhook-github')

      expect(metrics.getStats('webhook-github').fireCount).toBe(0)
      expect(metrics.getStats('webhook-stripe').fireCount).toBe(1)
    })
  })

  describe('Integration with MetricsCollector', () => {
    it('should forward metrics to collector', () => {
      const collector = new TestMetricsCollector()
      const metrics = createTriggerMetrics({ metricsCollector: collector })

      metrics.recordTriggerFired('webhook-github')
      metrics.recordTriggerSuccess('webhook-github', 100)

      expect(collector.getCounterTotal(TriggerMetricNames.TRIGGERS_FIRED)).toBe(1)
      expect(collector.getLatencies(TriggerMetricNames.TRIGGER_LATENCY)).toHaveLength(1)
    })

    it('should include trigger labels', () => {
      const collector = new TestMetricsCollector()
      const metrics = createTriggerMetrics({ metricsCollector: collector })

      metrics.recordTriggerFired('webhook-github')

      const events = collector.getByName(TriggerMetricNames.TRIGGERS_FIRED)
      expect(events[0]?.labels?.triggerId).toBe('webhook-github')
    })
  })
})

// ============================================================================
// TRIGGER OBSERVER TESTS
// ============================================================================

describe('TriggerObserver', () => {
  let observer: TriggerObserver

  beforeEach(() => {
    observer = createTriggerObserver()
  })

  describe('Execution Observation', () => {
    it('should observe trigger execution start', async () => {
      const startHandler = vi.fn()
      observer.onStart(startHandler)

      const ctx: TriggerExecutionContext = {
        triggerId: 'webhook-github',
        triggerType: 'webhook',
        timestamp: Date.now(),
      }

      await observer.notifyStart(ctx)

      expect(startHandler).toHaveBeenCalledWith(ctx)
    })

    it('should observe trigger execution success', async () => {
      const successHandler = vi.fn()
      observer.onSuccess(successHandler)

      const ctx: TriggerExecutionContext = {
        triggerId: 'webhook-github',
        triggerType: 'webhook',
        timestamp: Date.now(),
      }

      await observer.notifySuccess(ctx, { success: true, data: {} }, 100)

      expect(successHandler).toHaveBeenCalled()
    })

    it('should observe trigger execution failure', async () => {
      const failureHandler = vi.fn()
      observer.onFailure(failureHandler)

      const ctx: TriggerExecutionContext = {
        triggerId: 'webhook-github',
        triggerType: 'webhook',
        timestamp: Date.now(),
      }
      const error = new Error('Handler failed')

      await observer.notifyFailure(ctx, error, 50)

      expect(failureHandler).toHaveBeenCalledWith(ctx, error, 50)
    })

    it('should support multiple handlers', async () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      observer.onStart(handler1)
      observer.onStart(handler2)

      await observer.notifyStart({
        triggerId: 'webhook-github',
        triggerType: 'webhook',
        timestamp: Date.now(),
      })

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })

    it('should continue on handler error', async () => {
      const handler1 = vi.fn(() => { throw new Error('Handler error') })
      const handler2 = vi.fn()
      observer.onStart(handler1)
      observer.onStart(handler2)

      await observer.notifyStart({
        triggerId: 'webhook-github',
        triggerType: 'webhook',
        timestamp: Date.now(),
      })

      expect(handler1).toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
    })
  })

  describe('Unsubscribe', () => {
    it('should unsubscribe handler', async () => {
      const handler = vi.fn()
      const unsubscribe = observer.onStart(handler)

      unsubscribe()

      await observer.notifyStart({
        triggerId: 'webhook-github',
        triggerType: 'webhook',
        timestamp: Date.now(),
      })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('Integration with Metrics', () => {
    it('should auto-record metrics when configured', async () => {
      const metrics = createTriggerMetrics()
      observer = createTriggerObserver({ metrics })

      const ctx: TriggerExecutionContext = {
        triggerId: 'webhook-github',
        triggerType: 'webhook',
        timestamp: Date.now(),
      }

      await observer.notifyStart(ctx)
      await observer.notifySuccess(ctx, { success: true, data: {} }, 100)

      const stats = metrics.getStats('webhook-github')
      expect(stats.fireCount).toBe(1)
      expect(stats.successCount).toBe(1)
    })
  })
})

// ============================================================================
// ALERT THRESHOLD TESTS
// ============================================================================

describe('Alert Thresholds', () => {
  let metrics: TriggerMetrics

  beforeEach(() => {
    metrics = createTriggerMetrics()
  })

  describe('Fire Rate Alerts', () => {
    it('should trigger alert when fire rate exceeds threshold', () => {
      vi.useFakeTimers()

      const alertCallback = vi.fn()
      metrics.setAlert('webhook-github', {
        type: 'fire_rate',
        threshold: 5, // max 5/sec
        windowMs: 1000,
        callback: alertCallback,
      })

      // Fire 10 times in rapid succession
      for (let i = 0; i < 10; i++) {
        metrics.recordTriggerFired('webhook-github')
      }

      expect(alertCallback).toHaveBeenCalled()
      const alert = alertCallback.mock.calls[0][0]
      expect(alert.type).toBe('fire_rate')
      expect(alert.triggerId).toBe('webhook-github')
      expect(alert.value).toBeGreaterThanOrEqual(10)

      vi.useRealTimers()
    })
  })

  describe('Error Rate Alerts', () => {
    it('should trigger alert when error rate exceeds threshold', () => {
      const alertCallback = vi.fn()
      metrics.setAlert('webhook-github', {
        type: 'error_rate',
        threshold: 0.25, // max 25% error rate
        minSamples: 4,
        callback: alertCallback,
      })

      // 3 successes, 2 failures = 40% error rate
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerSuccess('webhook-github', 100)
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))

      expect(alertCallback).toHaveBeenCalled()
      const alert = alertCallback.mock.calls[0][0]
      expect(alert.type).toBe('error_rate')
      expect(alert.value).toBe(0.4)
    })

    it('should not trigger alert below min samples', () => {
      const alertCallback = vi.fn()
      metrics.setAlert('webhook-github', {
        type: 'error_rate',
        threshold: 0.25,
        minSamples: 10,
        callback: alertCallback,
      })

      // Only 4 samples
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))
      metrics.recordTriggerFailure('webhook-github', new Error('Failed'))

      expect(alertCallback).not.toHaveBeenCalled()
    })
  })

  describe('Latency Alerts', () => {
    it('should trigger alert when latency exceeds threshold', () => {
      const alertCallback = vi.fn()
      metrics.setAlert('webhook-github', {
        type: 'latency',
        threshold: 500, // max 500ms
        callback: alertCallback,
      })

      metrics.recordTriggerSuccess('webhook-github', 600)

      expect(alertCallback).toHaveBeenCalled()
      const alert = alertCallback.mock.calls[0][0]
      expect(alert.type).toBe('latency')
      expect(alert.value).toBe(600)
    })

    it('should trigger alert when p95 latency exceeds threshold', () => {
      const alertCallback = vi.fn()
      metrics.setAlert('webhook-github', {
        type: 'latency_p95',
        threshold: 100,
        callback: alertCallback,
      })

      // Add samples where p95 would be high
      for (let i = 0; i < 95; i++) {
        metrics.recordTriggerSuccess('webhook-github', 50)
      }
      for (let i = 0; i < 5; i++) {
        metrics.recordTriggerSuccess('webhook-github', 200)
      }

      // After adding high values, p95 should exceed threshold
      expect(alertCallback).toHaveBeenCalled()
    })
  })

  describe('Clear Alerts', () => {
    it('should clear alerts for trigger', () => {
      const alertCallback = vi.fn()
      metrics.setAlert('webhook-github', {
        type: 'latency',
        threshold: 500,
        callback: alertCallback,
      })

      metrics.clearAlerts('webhook-github')
      metrics.recordTriggerSuccess('webhook-github', 600)

      expect(alertCallback).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// TRIGGER TRACER TESTS
// ============================================================================

describe('TriggerTracer', () => {
  let tracer: TriggerTracer

  beforeEach(() => {
    tracer = createTriggerTracer()
  })

  describe('Span Creation', () => {
    it('should create a span for trigger execution', () => {
      const span = tracer.startSpan('trigger.execute', {
        triggerId: 'webhook-github',
        triggerType: 'webhook',
      })

      expect(span).toBeDefined()
      expect(span.traceId).toBeDefined()
      expect(span.spanId).toBeDefined()
      expect(span.name).toBe('trigger.execute')
    })

    it('should end span and record duration', () => {
      vi.useFakeTimers()

      const span = tracer.startSpan('trigger.execute', {
        triggerId: 'webhook-github',
      })

      vi.advanceTimersByTime(100)
      span.end()

      expect(span.duration).toBeGreaterThanOrEqual(100)
      expect(span.endTime).toBeDefined()

      vi.useRealTimers()
    })

    it('should set span attributes', () => {
      const span = tracer.startSpan('trigger.execute', {
        triggerId: 'webhook-github',
      })

      span.setAttribute('http.status', 200)
      span.setAttribute('custom.data', 'value')

      expect(span.attributes['http.status']).toBe(200)
      expect(span.attributes['custom.data']).toBe('value')
    })

    it('should record exceptions', () => {
      const span = tracer.startSpan('trigger.execute', {
        triggerId: 'webhook-github',
      })
      const error = new Error('Handler failed')

      span.recordException(error)
      span.end()

      expect(span.error).toBe(error)
      expect(span.status).toBe('error')
    })

    it('should set span status', () => {
      const span = tracer.startSpan('trigger.execute', {
        triggerId: 'webhook-github',
      })

      span.setStatus('ok')
      expect(span.status).toBe('ok')

      span.setStatus('error', 'Something went wrong')
      expect(span.status).toBe('error')
      expect(span.statusMessage).toBe('Something went wrong')
    })
  })

  describe('Span Context Propagation', () => {
    it('should propagate trace context to child spans', () => {
      const parentSpan = tracer.startSpan('trigger.execute', {
        triggerId: 'webhook-github',
      })

      const childSpan = tracer.startSpan('trigger.handler', {
        triggerId: 'webhook-github',
      }, parentSpan.context())

      expect(childSpan.traceId).toBe(parentSpan.traceId)
      expect(childSpan.parentSpanId).toBe(parentSpan.spanId)
      expect(childSpan.spanId).not.toBe(parentSpan.spanId)
    })

    it('should extract context from headers', () => {
      const headers = {
        'traceparent': '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      }

      const context = tracer.extractContext(headers)
      expect(context).toBeDefined()
      expect(context?.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
      expect(context?.parentSpanId).toBe('b7ad6b7169203331')
    })

    it('should inject context into headers', () => {
      const span = tracer.startSpan('trigger.execute', {
        triggerId: 'webhook-github',
      })

      const headers: Record<string, string> = {}
      tracer.injectContext(span.context(), headers)

      expect(headers['traceparent']).toBeDefined()
      expect(headers['traceparent']).toContain(span.traceId)
      expect(headers['traceparent']).toContain(span.spanId)
    })

    it('should return null for invalid traceparent', () => {
      const headers = {
        'traceparent': 'invalid-traceparent',
      }

      const context = tracer.extractContext(headers)
      expect(context).toBeNull()
    })

    it('should handle missing traceparent header', () => {
      const headers = {}
      const context = tracer.extractContext(headers)
      expect(context).toBeNull()
    })
  })

  describe('Span Export', () => {
    it('should export completed spans', () => {
      const exportHandler = vi.fn()
      tracer = createTriggerTracer({ onExport: exportHandler })

      const span = tracer.startSpan('trigger.execute', {
        triggerId: 'webhook-github',
      })
      span.end()

      expect(exportHandler).toHaveBeenCalledWith(span)
    })

    it('should batch span exports when configured', async () => {
      const exportHandler = vi.fn()
      tracer = createTriggerTracer({
        batchExport: true,
        batchSize: 3,
        onBatchExport: exportHandler,
      })

      for (let i = 0; i < 3; i++) {
        const span = tracer.startSpan(`trigger.${i}`, { triggerId: `trigger-${i}` })
        span.end()
      }

      // Should batch export after 3 spans
      expect(exportHandler).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ name: 'trigger.0' }),
        expect.objectContaining({ name: 'trigger.1' }),
        expect.objectContaining({ name: 'trigger.2' }),
      ]))
    })
  })

  describe('Sampling', () => {
    it('should sample spans based on rate', () => {
      tracer = createTriggerTracer({ samplingRate: 0 }) // No sampling

      const span = tracer.startSpan('trigger.execute', {
        triggerId: 'webhook-github',
      })

      expect(span.isSampled).toBe(false)
    })

    it('should always sample when rate is 1', () => {
      tracer = createTriggerTracer({ samplingRate: 1 })

      for (let i = 0; i < 10; i++) {
        const span = tracer.startSpan(`trigger.${i}`, { triggerId: `trigger-${i}` })
        expect(span.isSampled).toBe(true)
      }
    })
  })
})

// ============================================================================
// HELPER FUNCTION TESTS
// ============================================================================

describe('Helper Functions', () => {
  describe('Percentile Calculations', () => {
    it('should calculate P50', () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      expect(calculateP50(values)).toBeCloseTo(55, 0)
    })

    it('should calculate P95', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1)
      expect(calculateP95(values)).toBeGreaterThanOrEqual(94)
      expect(calculateP95(values)).toBeLessThanOrEqual(96)
    })

    it('should calculate P99', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1)
      expect(calculateP99(values)).toBeGreaterThanOrEqual(98)
      expect(calculateP99(values)).toBeLessThanOrEqual(100)
    })

    it('should return 0 for empty array', () => {
      expect(calculateP50([])).toBe(0)
      expect(calculateP95([])).toBe(0)
      expect(calculateP99([])).toBe(0)
    })

    it('should handle single element', () => {
      expect(calculateP50([42])).toBe(42)
      expect(calculateP95([42])).toBe(42)
      expect(calculateP99([42])).toBe(42)
    })
  })
})

// ============================================================================
// METRIC NAMES TESTS
// ============================================================================

describe('TriggerMetricNames', () => {
  it('should have all required metric names', () => {
    expect(TriggerMetricNames.TRIGGERS_FIRED).toBeDefined()
    expect(TriggerMetricNames.TRIGGER_SUCCESS).toBeDefined()
    expect(TriggerMetricNames.TRIGGER_FAILURE).toBeDefined()
    expect(TriggerMetricNames.TRIGGER_LATENCY).toBeDefined()
    expect(TriggerMetricNames.TRIGGER_FIRE_RATE).toBeDefined()
    expect(TriggerMetricNames.TRIGGER_ERROR_RATE).toBeDefined()
    expect(TriggerMetricNames.ACTIVE_TRIGGERS).toBeDefined()
  })

  it('should have consistent naming convention', () => {
    Object.values(TriggerMetricNames).forEach((name) => {
      expect(name).toMatch(/^trigger\./)
    })
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Observability Integration', () => {
  it('should work with all components together', async () => {
    const collector = new TestMetricsCollector()
    const metrics = createTriggerMetrics({ metricsCollector: collector })
    const tracer = createTriggerTracer()
    const observer = createTriggerObserver({ metrics })

    const alertCallback = vi.fn()
    metrics.setAlert('webhook-github', {
      type: 'latency',
      threshold: 50,
      callback: alertCallback,
    })

    // Simulate trigger execution with tracing
    const span = tracer.startSpan('trigger.execute', {
      triggerId: 'webhook-github',
      triggerType: 'webhook',
    })

    const ctx: TriggerExecutionContext = {
      triggerId: 'webhook-github',
      triggerType: 'webhook',
      timestamp: Date.now(),
      traceContext: span.context(),
    }

    await observer.notifyStart(ctx)

    // Simulate some work
    await new Promise((r) => setTimeout(r, 10))

    await observer.notifySuccess(ctx, { success: true, data: {} }, 100)
    span.setStatus('ok')
    span.end()

    // Verify metrics were collected
    const stats = metrics.getStats('webhook-github')
    expect(stats.fireCount).toBe(1)
    expect(stats.successCount).toBe(1)

    // Verify collector received metrics
    expect(collector.getCounterTotal(TriggerMetricNames.TRIGGERS_FIRED)).toBe(1)

    // Verify alert was triggered
    expect(alertCallback).toHaveBeenCalled()
  })

  it('should propagate trace context through trigger chain', async () => {
    const tracer = createTriggerTracer()
    const observer = createTriggerObserver()

    // Parent trigger
    const parentSpan = tracer.startSpan('trigger.webhook', {
      triggerId: 'webhook-github',
    })

    // Child trigger (downstream)
    const childSpan = tracer.startSpan('trigger.event', {
      triggerId: 'event-user-signup',
    }, parentSpan.context())

    // Verify propagation
    expect(childSpan.traceId).toBe(parentSpan.traceId)
    expect(childSpan.parentSpanId).toBe(parentSpan.spanId)

    parentSpan.end()
    childSpan.end()
  })
})
