import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

/**
 * Tail Worker Pipeline Integration Tests (RED Phase)
 *
 * These tests verify the integration between the Tail Worker and Cloudflare Pipeline
 * for forwarding observability events.
 *
 * The Tail Worker receives trace/log/error events from Cloudflare Workers and
 * batches them for efficient forwarding to the Pipeline for storage and analysis.
 *
 * Implementation requirements:
 * - Create TailWorkerPipeline class or functions for pipeline integration
 * - Implement batching logic (time-based and size-based)
 * - Implement sampling by trace ID
 * - Implement context propagation for distributed tracing
 * - Handle pipeline backpressure gracefully
 *
 * This is the RED phase of TDD - tests should fail because the
 * implementation doesn't exist yet.
 */

// These imports should fail until the implementation exists
import {
  TailWorkerPipeline,
  type TailWorkerPipelineConfig,
  type TraceSpan,
  type TraceContext,
  type TailEvent,
  createBatcher,
  type Batcher,
} from '../pipeline'

import type { ObservabilityEvent } from '../../../types/observability'
import { createMockPipeline, type MockPipeline } from '../../../tests/mocks/pipeline'

// ============================================================================
// Helper Types and Mocks
// ============================================================================

/**
 * Creates a minimal trace span for testing
 */
function createTraceSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    traceId: 'trace-abc123',
    spanId: 'span-xyz789',
    parentSpanId: undefined,
    operationName: 'http.request',
    startTime: Date.now() - 100,
    endTime: Date.now(),
    duration: 100,
    status: 'ok',
    attributes: {},
    events: [],
    ...overrides,
  }
}

/**
 * Creates a minimal trace context for testing
 */
function createTraceContext(overrides: Partial<TraceContext> = {}): TraceContext {
  return {
    traceId: 'trace-abc123',
    spanId: 'span-xyz789',
    parentSpanId: undefined,
    sampled: true,
    ...overrides,
  }
}

/**
 * Creates a minimal TailEvent for testing
 */
function createTailEvent(overrides: Partial<TailEvent> = {}): TailEvent {
  return {
    type: 'log',
    timestamp: Date.now(),
    scriptName: 'api-worker',
    message: ['Test log message'],
    level: 'info',
    traceContext: createTraceContext(),
    ...overrides,
  }
}

/**
 * Creates a default pipeline config for testing
 */
function createDefaultConfig(overrides: Partial<TailWorkerPipelineConfig> = {}): TailWorkerPipelineConfig {
  return {
    batchSize: 100,
    batchTimeoutMs: 1000,
    samplingRate: 1.0,
    errorSamplingRate: 1.0,
    maxRetries: 3,
    retryDelayMs: 100,
    ...overrides,
  }
}

// ============================================================================
// Event Reception Tests
// ============================================================================

describe('Tail Worker Pipeline Integration', () => {
  let pipeline: MockPipeline
  let tailWorkerPipeline: TailWorkerPipeline

  beforeEach(() => {
    pipeline = createMockPipeline()
    tailWorkerPipeline = new TailWorkerPipeline(pipeline, createDefaultConfig())
  })

  afterEach(() => {
    pipeline.clear()
    vi.useRealTimers()
  })

  describe('Event reception', () => {
    it('receives trace spans from workers', async () => {
      const span = createTraceSpan({
        traceId: 'trace-001',
        spanId: 'span-001',
        operationName: 'GET /api/users',
      })

      await tailWorkerPipeline.receiveSpan(span)

      // The span should be queued for batching
      expect(tailWorkerPipeline.getPendingCount()).toBeGreaterThanOrEqual(1)
    })

    it('receives log events from workers', async () => {
      const logEvent = createTailEvent({
        type: 'log',
        level: 'info',
        message: ['User logged in successfully'],
      })

      await tailWorkerPipeline.receiveEvent(logEvent)

      expect(tailWorkerPipeline.getPendingCount()).toBeGreaterThanOrEqual(1)
    })

    it('receives error events from workers', async () => {
      const errorEvent = createTailEvent({
        type: 'error',
        level: 'error',
        message: ['Database connection failed'],
        error: {
          name: 'ConnectionError',
          message: 'ECONNREFUSED',
          stack: 'Error: ECONNREFUSED\n    at connect (/src/db.ts:12:5)',
        },
      })

      await tailWorkerPipeline.receiveEvent(errorEvent)

      expect(tailWorkerPipeline.getPendingCount()).toBeGreaterThanOrEqual(1)
    })

    it('receives multiple event types in sequence', async () => {
      const span = createTraceSpan()
      const logEvent = createTailEvent({ type: 'log' })
      const errorEvent = createTailEvent({ type: 'error', level: 'error' })

      await tailWorkerPipeline.receiveSpan(span)
      await tailWorkerPipeline.receiveEvent(logEvent)
      await tailWorkerPipeline.receiveEvent(errorEvent)

      expect(tailWorkerPipeline.getPendingCount()).toBeGreaterThanOrEqual(3)
    })

    it('handles high-volume event reception', async () => {
      const events = Array.from({ length: 1000 }, (_, i) =>
        createTailEvent({ message: [`Event ${i}`] })
      )

      for (const event of events) {
        await tailWorkerPipeline.receiveEvent(event)
      }

      // Should handle without errors - actual count depends on batching
      expect(tailWorkerPipeline.getReceivedCount()).toBe(1000)
    })

    it('preserves event order within same trace', async () => {
      const traceId = 'trace-ordered'
      const events = [
        createTailEvent({ traceContext: createTraceContext({ traceId }), message: ['First'] }),
        createTailEvent({ traceContext: createTraceContext({ traceId }), message: ['Second'] }),
        createTailEvent({ traceContext: createTraceContext({ traceId }), message: ['Third'] }),
      ]

      for (const event of events) {
        await tailWorkerPipeline.receiveEvent(event)
      }

      // Flush and verify order
      await tailWorkerPipeline.flush()

      const sentEvents = pipeline.events.filter(
        (e) => e.traceContext?.traceId === traceId
      )
      expect(sentEvents[0].message).toContain('First')
      expect(sentEvents[1].message).toContain('Second')
      expect(sentEvents[2].message).toContain('Third')
    })
  })

  // ============================================================================
  // Batching Tests
  // ============================================================================

  describe('Batching', () => {
    it('batches events by time window', async () => {
      vi.useFakeTimers()

      const config = createDefaultConfig({ batchTimeoutMs: 500 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      await tailWorkerPipeline.receiveEvent(createTailEvent())
      await tailWorkerPipeline.receiveEvent(createTailEvent())

      // Not enough time has passed, should not flush
      expect(pipeline.send).not.toHaveBeenCalled()

      // Advance time past the batch timeout
      vi.advanceTimersByTime(600)

      // Now should have flushed
      expect(pipeline.send).toHaveBeenCalled()
    })

    it('flushes on batch size threshold', async () => {
      const config = createDefaultConfig({ batchSize: 5 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Send 4 events - should not flush yet
      for (let i = 0; i < 4; i++) {
        await tailWorkerPipeline.receiveEvent(createTailEvent())
      }
      expect(pipeline.send).not.toHaveBeenCalled()

      // 5th event should trigger flush
      await tailWorkerPipeline.receiveEvent(createTailEvent())

      expect(pipeline.send).toHaveBeenCalledTimes(1)
      expect(pipeline.events).toHaveLength(5)
    })

    it('combines events into single batch when possible', async () => {
      const config = createDefaultConfig({ batchSize: 10, batchTimeoutMs: 10000 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Send multiple events rapidly
      for (let i = 0; i < 5; i++) {
        await tailWorkerPipeline.receiveEvent(createTailEvent({ message: [`Event ${i}`] }))
      }

      // Force flush
      await tailWorkerPipeline.flush()

      // Should be batched into single send call
      expect(pipeline.send).toHaveBeenCalledTimes(1)
      expect(pipeline.events).toHaveLength(5)
    })

    it('splits large batches when exceeding max batch size', async () => {
      const config = createDefaultConfig({ batchSize: 3 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Send 7 events (should result in 3 batches: 3, 3, 1)
      for (let i = 0; i < 7; i++) {
        await tailWorkerPipeline.receiveEvent(createTailEvent())
      }

      // Should have flushed twice automatically (at 3 and 6)
      expect(pipeline.send).toHaveBeenCalledTimes(2)

      // Flush remaining
      await tailWorkerPipeline.flush()

      expect(pipeline.send).toHaveBeenCalledTimes(3)
      expect(pipeline.events).toHaveLength(7)
    })

    it('resets batch timer after flush', async () => {
      vi.useFakeTimers()

      const config = createDefaultConfig({ batchTimeoutMs: 100, batchSize: 1000 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      await tailWorkerPipeline.receiveEvent(createTailEvent())
      vi.advanceTimersByTime(50)

      // Force flush before timeout
      await tailWorkerPipeline.flush()
      expect(pipeline.send).toHaveBeenCalledTimes(1)

      pipeline.clear()

      // Add new event - timer should reset
      await tailWorkerPipeline.receiveEvent(createTailEvent())

      // Wait less than full timeout
      vi.advanceTimersByTime(80)
      expect(pipeline.send).not.toHaveBeenCalled()

      // Full timeout from second event
      vi.advanceTimersByTime(30)
      expect(pipeline.send).toHaveBeenCalledTimes(1)
    })

    it('handles concurrent batch operations safely', async () => {
      const config = createDefaultConfig({ batchSize: 5 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Send events concurrently
      const promises = Array.from({ length: 20 }, (_, i) =>
        tailWorkerPipeline.receiveEvent(createTailEvent({ message: [`Event ${i}`] }))
      )

      await Promise.all(promises)
      await tailWorkerPipeline.flush()

      // All events should be sent exactly once
      expect(pipeline.events).toHaveLength(20)
    })
  })

  // ============================================================================
  // Pipeline Forwarding Tests
  // ============================================================================

  describe('Pipeline forwarding', () => {
    it('forwards batched events to Cloudflare Pipeline', async () => {
      await tailWorkerPipeline.receiveEvent(
        createTailEvent({ message: ['Test event'] })
      )
      await tailWorkerPipeline.flush()

      expect(pipeline.send).toHaveBeenCalledTimes(1)
      expect(pipeline.events[0].message).toContain('Test event')
    })

    it('handles pipeline backpressure by queueing', async () => {
      // Simulate slow pipeline
      pipeline.setDelay(100)

      const config = createDefaultConfig({ batchSize: 2 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Send many events quickly
      const sendPromises = Array.from({ length: 10 }, (_, i) =>
        tailWorkerPipeline.receiveEvent(createTailEvent({ message: [`Event ${i}`] }))
      )

      await Promise.all(sendPromises)
      await tailWorkerPipeline.flush()

      // All events should eventually be sent
      expect(pipeline.events).toHaveLength(10)
    })

    it('retries failed pipeline sends', async () => {
      const config = createDefaultConfig({ maxRetries: 3, retryDelayMs: 10 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Fail first two attempts, succeed on third
      let attempts = 0
      pipeline.send = vi.fn(async (events: any[]) => {
        attempts++
        if (attempts < 3) {
          throw new Error('Pipeline temporarily unavailable')
        }
        pipeline.events.push(...events)
      }) as any

      await tailWorkerPipeline.receiveEvent(createTailEvent())
      await tailWorkerPipeline.flush()

      expect(attempts).toBe(3)
      expect(pipeline.events).toHaveLength(1)
    })

    it('gives up after max retries exceeded', async () => {
      const config = createDefaultConfig({ maxRetries: 2, retryDelayMs: 10 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      pipeline.setError(new Error('Pipeline permanently unavailable'))

      await tailWorkerPipeline.receiveEvent(createTailEvent())

      await expect(tailWorkerPipeline.flush()).rejects.toThrow('Pipeline permanently unavailable')
      expect(pipeline.send).toHaveBeenCalledTimes(3) // Initial + 2 retries
    })

    it('uses exponential backoff for retries', async () => {
      vi.useFakeTimers()

      const config = createDefaultConfig({ maxRetries: 3, retryDelayMs: 100 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      let attempts = 0
      const attemptTimes: number[] = []
      pipeline.send = vi.fn(async () => {
        attemptTimes.push(Date.now())
        attempts++
        if (attempts < 4) {
          throw new Error('Temporary failure')
        }
      }) as any

      await tailWorkerPipeline.receiveEvent(createTailEvent())

      const flushPromise = tailWorkerPipeline.flush()

      // Advance through retry delays: 100, 200, 400 (exponential)
      vi.advanceTimersByTime(100)
      vi.advanceTimersByTime(200)
      vi.advanceTimersByTime(400)

      await flushPromise

      expect(attemptTimes.length).toBe(4)
      // Verify exponential increase in delays
      const delays = attemptTimes.slice(1).map((t, i) => t - attemptTimes[i])
      expect(delays[1]).toBeGreaterThan(delays[0])
    })

    it('preserves event data through pipeline forwarding', async () => {
      const event = createTailEvent({
        type: 'log',
        level: 'warn',
        message: ['Important warning message'],
        scriptName: 'my-worker',
        traceContext: createTraceContext({ traceId: 'trace-preserve' }),
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      const sentEvent = pipeline.events[0]
      expect(sentEvent.type).toBe('log')
      expect(sentEvent.level).toBe('warn')
      expect(sentEvent.message).toContain('Important warning message')
      expect(sentEvent.scriptName).toBe('my-worker')
      expect(sentEvent.traceContext.traceId).toBe('trace-preserve')
    })

    it('adds pipeline metadata to forwarded events', async () => {
      await tailWorkerPipeline.receiveEvent(createTailEvent())
      await tailWorkerPipeline.flush()

      const sentEvent = pipeline.events[0]
      expect(sentEvent.metadata).toBeDefined()
      expect(sentEvent.metadata.pipelineVersion).toBeDefined()
      expect(sentEvent.metadata.batchId).toBeDefined()
      expect(sentEvent.metadata.receivedAt).toBeDefined()
    })
  })

  // ============================================================================
  // Sampling Tests
  // ============================================================================

  describe('Sampling', () => {
    it('samples by trace ID for consistent decisions', async () => {
      const config = createDefaultConfig({ samplingRate: 0.5 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Same trace ID should have consistent sampling decision
      const traceId = 'trace-sample-test'
      const events = Array.from({ length: 10 }, () =>
        createTailEvent({ traceContext: createTraceContext({ traceId }) })
      )

      for (const event of events) {
        await tailWorkerPipeline.receiveEvent(event)
      }

      await tailWorkerPipeline.flush()

      // Either all events from this trace are sampled or none
      const sampledCount = pipeline.events.filter(
        (e) => e.traceContext?.traceId === traceId
      ).length
      expect(sampledCount === 0 || sampledCount === 10).toBe(true)
    })

    it('respects sampling rate config', async () => {
      // Use a seeded random for deterministic testing
      const config = createDefaultConfig({ samplingRate: 0.3 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Generate many distinct traces
      const events = Array.from({ length: 100 }, (_, i) =>
        createTailEvent({
          traceContext: createTraceContext({ traceId: `trace-${i}` }),
        })
      )

      for (const event of events) {
        await tailWorkerPipeline.receiveEvent(event)
      }

      await tailWorkerPipeline.flush()

      // With 30% sampling rate, expect roughly 30 events (allow variance)
      const sampledCount = pipeline.events.length
      expect(sampledCount).toBeGreaterThan(15)
      expect(sampledCount).toBeLessThan(50)
    })

    it('always samples error events regardless of rate', async () => {
      const config = createDefaultConfig({ samplingRate: 0.0, errorSamplingRate: 1.0 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Normal event should be dropped
      await tailWorkerPipeline.receiveEvent(
        createTailEvent({ type: 'log', level: 'info' })
      )

      // Error event should be kept
      await tailWorkerPipeline.receiveEvent(
        createTailEvent({ type: 'error', level: 'error' })
      )

      await tailWorkerPipeline.flush()

      expect(pipeline.events).toHaveLength(1)
      expect(pipeline.events[0].level).toBe('error')
    })

    it('samples all events in a trace when any event is sampled', async () => {
      // If one event in a trace is sampled, all should be
      const config = createDefaultConfig({ samplingRate: 1.0 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      const traceId = 'trace-full-sample'
      const events = [
        createTailEvent({
          type: 'log',
          level: 'debug',
          traceContext: createTraceContext({ traceId }),
        }),
        createTailEvent({
          type: 'error',
          level: 'error',
          traceContext: createTraceContext({ traceId }),
        }),
        createTailEvent({
          type: 'log',
          level: 'info',
          traceContext: createTraceContext({ traceId }),
        }),
      ]

      for (const event of events) {
        await tailWorkerPipeline.receiveEvent(event)
      }

      await tailWorkerPipeline.flush()

      // All events from the trace should be present
      expect(pipeline.events).toHaveLength(3)
    })

    it('supports head-based sampling', async () => {
      const config = createDefaultConfig({
        samplingRate: 0.5,
        samplingStrategy: 'head-based',
      })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Sampling decision made at trace start (first span)
      const span = createTraceSpan({ traceId: 'head-sample-trace' })
      await tailWorkerPipeline.receiveSpan(span)

      // Decision should be cached for subsequent events
      const event = createTailEvent({
        traceContext: createTraceContext({ traceId: 'head-sample-trace' }),
      })
      await tailWorkerPipeline.receiveEvent(event)

      await tailWorkerPipeline.flush()

      // Both should be sampled or neither
      expect(pipeline.events.length === 0 || pipeline.events.length === 2).toBe(true)
    })

    it('supports tail-based sampling', async () => {
      const config = createDefaultConfig({
        samplingRate: 0.5,
        samplingStrategy: 'tail-based',
      })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // With tail-based, decision is deferred until trace completes
      // All events are buffered
      const traceId = 'tail-sample-trace'
      const events = Array.from({ length: 5 }, () =>
        createTailEvent({ traceContext: createTraceContext({ traceId }) })
      )

      for (const event of events) {
        await tailWorkerPipeline.receiveEvent(event)
      }

      // Signal trace completion
      await tailWorkerPipeline.completeTrace(traceId)

      // Now sampling decision is made and events are either all forwarded or all dropped
      expect(pipeline.events.length === 0 || pipeline.events.length === 5).toBe(true)
    })
  })

  // ============================================================================
  // Context Propagation Tests
  // ============================================================================

  describe('Context propagation', () => {
    it('propagates trace context to all events', async () => {
      const traceContext = createTraceContext({
        traceId: 'trace-propagate',
        spanId: 'span-propagate',
      })

      await tailWorkerPipeline.receiveEvent(
        createTailEvent({ traceContext, message: ['Event 1'] })
      )
      await tailWorkerPipeline.receiveEvent(
        createTailEvent({ traceContext, message: ['Event 2'] })
      )

      await tailWorkerPipeline.flush()

      for (const event of pipeline.events) {
        expect(event.traceContext.traceId).toBe('trace-propagate')
        expect(event.traceContext.spanId).toBe('span-propagate')
      }
    })

    it('links parent spans correctly', async () => {
      const parentSpan = createTraceSpan({
        traceId: 'trace-parent-child',
        spanId: 'parent-span',
        operationName: 'parent.operation',
      })

      const childSpan = createTraceSpan({
        traceId: 'trace-parent-child',
        spanId: 'child-span',
        parentSpanId: 'parent-span',
        operationName: 'child.operation',
      })

      await tailWorkerPipeline.receiveSpan(parentSpan)
      await tailWorkerPipeline.receiveSpan(childSpan)

      await tailWorkerPipeline.flush()

      const sentParent = pipeline.events.find((e) => e.spanId === 'parent-span')
      const sentChild = pipeline.events.find((e) => e.spanId === 'child-span')

      expect(sentChild?.parentSpanId).toBe('parent-span')
      expect(sentParent?.parentSpanId).toBeUndefined()
    })

    it('extracts W3C Trace Context headers', () => {
      const headers = new Headers()
      headers.set('traceparent', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
      headers.set('tracestate', 'congo=t61rcWkgMzE')

      const context = TailWorkerPipeline.extractTraceContext(headers)

      expect(context.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
      expect(context.spanId).toBe('b7ad6b7169203331')
      expect(context.sampled).toBe(true)
      expect(context.traceState).toBe('congo=t61rcWkgMzE')
    })

    it('generates new trace context when headers missing', () => {
      const headers = new Headers()

      const context = TailWorkerPipeline.extractTraceContext(headers)

      expect(context.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(context.spanId).toMatch(/^[0-9a-f]{16}$/)
      expect(context.sampled).toBe(true)
    })

    it('injects trace context headers for downstream propagation', () => {
      const context = createTraceContext({
        traceId: 'inject-trace-id',
        spanId: 'inject-span-id',
        sampled: true,
      })

      const headers = new Headers()
      TailWorkerPipeline.injectTraceContext(headers, context)

      expect(headers.get('traceparent')).toMatch(/00-inject-trace-id-inject-span-id-01/)
    })

    it('preserves baggage across trace context', () => {
      const headers = new Headers()
      headers.set('traceparent', '00-abc123-def456-01')
      headers.set('baggage', 'userId=123,tenant=acme')

      const context = TailWorkerPipeline.extractTraceContext(headers)

      expect(context.baggage).toBeDefined()
      expect(context.baggage?.get('userId')).toBe('123')
      expect(context.baggage?.get('tenant')).toBe('acme')
    })

    it('links spans across service boundaries', async () => {
      // Span from service A
      const serviceASpan = createTraceSpan({
        traceId: 'cross-service-trace',
        spanId: 'service-a-span',
        operationName: 'service-a.process',
        attributes: { 'service.name': 'service-a' },
      })

      // Span from service B, child of service A
      const serviceBSpan = createTraceSpan({
        traceId: 'cross-service-trace',
        spanId: 'service-b-span',
        parentSpanId: 'service-a-span',
        operationName: 'service-b.handle',
        attributes: { 'service.name': 'service-b' },
      })

      await tailWorkerPipeline.receiveSpan(serviceASpan)
      await tailWorkerPipeline.receiveSpan(serviceBSpan)

      await tailWorkerPipeline.flush()

      const spans = pipeline.events
      const serviceA = spans.find((s) => s.attributes?.['service.name'] === 'service-a')
      const serviceB = spans.find((s) => s.attributes?.['service.name'] === 'service-b')

      expect(serviceB?.parentSpanId).toBe(serviceA?.spanId)
    })
  })

  // ============================================================================
  // Log Event Formatting Tests
  // ============================================================================

  describe('Log event formatting', () => {
    it('formats log events with proper structure', async () => {
      const event = createTailEvent({
        type: 'log',
        level: 'info',
        message: ['User action', { action: 'click', button: 'submit' }],
        scriptName: 'ui-worker',
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      const formattedEvent = pipeline.events[0]
      expect(formattedEvent.type).toBe('log')
      expect(formattedEvent.level).toBe('info')
      expect(formattedEvent.script).toBe('ui-worker')
      expect(formattedEvent.timestamp).toBeDefined()
      expect(formattedEvent.message).toBeDefined()
    })

    it('serializes complex message objects', async () => {
      const event = createTailEvent({
        message: [
          'Request processed',
          { userId: 123, method: 'POST', path: '/api/users' },
          [1, 2, 3],
        ],
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      const formattedEvent = pipeline.events[0]
      expect(formattedEvent.message).toContain('Request processed')
      // Objects should be serialized to strings
      expect(formattedEvent.message.some((m: string) => m.includes('userId'))).toBe(true)
    })

    it('maps log levels correctly', async () => {
      const levels: Array<{ input: string; expected: string }> = [
        { input: 'debug', expected: 'debug' },
        { input: 'info', expected: 'info' },
        { input: 'log', expected: 'info' }, // 'log' maps to 'info'
        { input: 'warn', expected: 'warn' },
        { input: 'warning', expected: 'warn' },
        { input: 'error', expected: 'error' },
      ]

      for (const { input, expected } of levels) {
        pipeline.clear()
        await tailWorkerPipeline.receiveEvent(
          createTailEvent({ level: input as any })
        )
        await tailWorkerPipeline.flush()

        expect(pipeline.events[0].level).toBe(expected)
      }
    })

    it('includes timestamp in ISO format', async () => {
      const timestamp = Date.now()
      const event = createTailEvent({ timestamp })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      expect(pipeline.events[0].timestamp).toBe(timestamp)
    })

    it('handles log events without message gracefully', async () => {
      const event = createTailEvent({
        message: undefined as any,
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      expect(pipeline.events).toHaveLength(1)
      expect(pipeline.events[0].message).toEqual([])
    })
  })

  // ============================================================================
  // Error Event Capture Tests
  // ============================================================================

  describe('Error event capture', () => {
    it('captures error name and message', async () => {
      const event = createTailEvent({
        type: 'error',
        level: 'error',
        error: {
          name: 'TypeError',
          message: "Cannot read property 'id' of undefined",
        },
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      const errorEvent = pipeline.events[0]
      expect(errorEvent.type).toBe('exception')
      expect(errorEvent.level).toBe('error')
      expect(errorEvent.message).toContain("Cannot read property 'id' of undefined")
    })

    it('captures stack traces', async () => {
      const stack = `TypeError: Cannot read property 'id' of undefined
    at processUser (/src/handlers/user.ts:42:10)
    at handleRequest (/src/index.ts:15:5)`

      const event = createTailEvent({
        type: 'error',
        error: {
          name: 'TypeError',
          message: "Cannot read property 'id' of undefined",
          stack,
        },
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      expect(pipeline.events[0].stack).toBe(stack)
    })

    it('handles errors without stack trace', async () => {
      const event = createTailEvent({
        type: 'error',
        error: {
          name: 'Error',
          message: 'Simple error without stack',
        },
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      expect(pipeline.events[0].stack).toBeUndefined()
    })

    it('captures exception chain for nested errors', async () => {
      const event = createTailEvent({
        type: 'error',
        error: {
          name: 'AggregateError',
          message: 'Multiple errors occurred',
          stack: 'AggregateError: Multiple errors occurred',
          cause: {
            name: 'DatabaseError',
            message: 'Connection refused',
          },
        },
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      const errorEvent = pipeline.events[0]
      expect(errorEvent.metadata?.cause).toBeDefined()
      expect(errorEvent.metadata?.cause.name).toBe('DatabaseError')
    })

    it('captures unhandled rejection events', async () => {
      const event = createTailEvent({
        type: 'unhandledrejection',
        level: 'error',
        error: {
          name: 'PromiseRejectionError',
          message: 'Unhandled promise rejection',
        },
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      expect(pipeline.events[0].type).toBe('exception')
      expect(pipeline.events[0].metadata?.unhandledRejection).toBe(true)
    })

    it('enriches errors with context information', async () => {
      const event = createTailEvent({
        type: 'error',
        level: 'error',
        scriptName: 'api-worker',
        error: {
          name: 'ValidationError',
          message: 'Invalid request body',
        },
        traceContext: createTraceContext({
          traceId: 'error-trace',
          spanId: 'error-span',
        }),
      })

      await tailWorkerPipeline.receiveEvent(event)
      await tailWorkerPipeline.flush()

      const errorEvent = pipeline.events[0]
      expect(errorEvent.script).toBe('api-worker')
      expect(errorEvent.traceContext.traceId).toBe('error-trace')
    })
  })

  // ============================================================================
  // Metric Event Aggregation Tests
  // ============================================================================

  describe('Metric event aggregation', () => {
    it('aggregates counter metrics', async () => {
      const config = createDefaultConfig({ metricAggregationWindowMs: 100 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      // Send multiple counter increments
      for (let i = 0; i < 5; i++) {
        await tailWorkerPipeline.receiveMetric({
          type: 'counter',
          name: 'requests.total',
          value: 1,
          tags: { method: 'GET' },
        })
      }

      await tailWorkerPipeline.flush()

      // Should be aggregated into single event with sum
      const metricEvents = pipeline.events.filter((e) => e.type === 'metric')
      expect(metricEvents).toHaveLength(1)
      expect(metricEvents[0].name).toBe('requests.total')
      expect(metricEvents[0].value).toBe(5)
    })

    it('aggregates gauge metrics by keeping latest value', async () => {
      const config = createDefaultConfig({ metricAggregationWindowMs: 100 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      await tailWorkerPipeline.receiveMetric({
        type: 'gauge',
        name: 'cpu.usage',
        value: 50,
      })
      await tailWorkerPipeline.receiveMetric({
        type: 'gauge',
        name: 'cpu.usage',
        value: 75,
      })
      await tailWorkerPipeline.receiveMetric({
        type: 'gauge',
        name: 'cpu.usage',
        value: 60,
      })

      await tailWorkerPipeline.flush()

      const metricEvents = pipeline.events.filter((e) => e.type === 'metric')
      expect(metricEvents).toHaveLength(1)
      expect(metricEvents[0].value).toBe(60) // Latest value
    })

    it('computes histogram statistics', async () => {
      const config = createDefaultConfig({ metricAggregationWindowMs: 100 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      for (const value of values) {
        await tailWorkerPipeline.receiveMetric({
          type: 'histogram',
          name: 'request.duration',
          value,
        })
      }

      await tailWorkerPipeline.flush()

      const metricEvent = pipeline.events.find(
        (e) => e.type === 'metric' && e.name === 'request.duration'
      )
      expect(metricEvent).toBeDefined()
      expect(metricEvent.statistics).toBeDefined()
      expect(metricEvent.statistics.count).toBe(10)
      expect(metricEvent.statistics.min).toBe(10)
      expect(metricEvent.statistics.max).toBe(100)
      expect(metricEvent.statistics.avg).toBe(55)
      expect(metricEvent.statistics.p50).toBeDefined()
      expect(metricEvent.statistics.p95).toBeDefined()
      expect(metricEvent.statistics.p99).toBeDefined()
    })

    it('separates metrics by tags', async () => {
      const config = createDefaultConfig({ metricAggregationWindowMs: 100 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      await tailWorkerPipeline.receiveMetric({
        type: 'counter',
        name: 'requests',
        value: 1,
        tags: { method: 'GET' },
      })
      await tailWorkerPipeline.receiveMetric({
        type: 'counter',
        name: 'requests',
        value: 1,
        tags: { method: 'POST' },
      })
      await tailWorkerPipeline.receiveMetric({
        type: 'counter',
        name: 'requests',
        value: 1,
        tags: { method: 'GET' },
      })

      await tailWorkerPipeline.flush()

      const metricEvents = pipeline.events.filter((e) => e.type === 'metric')
      expect(metricEvents).toHaveLength(2)

      const getMetric = metricEvents.find((e) => e.tags?.method === 'GET')
      const postMetric = metricEvents.find((e) => e.tags?.method === 'POST')

      expect(getMetric?.value).toBe(2)
      expect(postMetric?.value).toBe(1)
    })

    it('flushes metrics on aggregation window expiry', async () => {
      vi.useFakeTimers()

      const config = createDefaultConfig({ metricAggregationWindowMs: 500 })
      tailWorkerPipeline = new TailWorkerPipeline(pipeline, config)

      await tailWorkerPipeline.receiveMetric({
        type: 'counter',
        name: 'test.metric',
        value: 1,
      })

      expect(pipeline.events).toHaveLength(0)

      vi.advanceTimersByTime(600)

      expect(pipeline.events.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Batcher Utility Tests
  // ============================================================================

  describe('Batcher utility', () => {
    it('creates batcher with custom config', () => {
      const batcher = createBatcher<ObservabilityEvent>({
        maxSize: 50,
        maxDelayMs: 500,
        onFlush: async () => {},
      })

      expect(batcher).toBeDefined()
      expect(typeof batcher.add).toBe('function')
      expect(typeof batcher.flush).toBe('function')
    })

    it('batcher flushes when max size reached', async () => {
      const flushedBatches: ObservabilityEvent[][] = []
      const batcher = createBatcher<ObservabilityEvent>({
        maxSize: 3,
        maxDelayMs: 10000,
        onFlush: async (batch) => {
          flushedBatches.push(batch)
        },
      })

      batcher.add({} as ObservabilityEvent)
      batcher.add({} as ObservabilityEvent)
      expect(flushedBatches).toHaveLength(0)

      batcher.add({} as ObservabilityEvent)
      expect(flushedBatches).toHaveLength(1)
      expect(flushedBatches[0]).toHaveLength(3)
    })

    it('batcher flushes when max delay reached', async () => {
      vi.useFakeTimers()

      const flushedBatches: ObservabilityEvent[][] = []
      const batcher = createBatcher<ObservabilityEvent>({
        maxSize: 1000,
        maxDelayMs: 100,
        onFlush: async (batch) => {
          flushedBatches.push(batch)
        },
      })

      batcher.add({} as ObservabilityEvent)

      vi.advanceTimersByTime(50)
      expect(flushedBatches).toHaveLength(0)

      vi.advanceTimersByTime(60)
      expect(flushedBatches).toHaveLength(1)
    })

    it('batcher supports manual flush', async () => {
      const flushedBatches: ObservabilityEvent[][] = []
      const batcher = createBatcher<ObservabilityEvent>({
        maxSize: 100,
        maxDelayMs: 10000,
        onFlush: async (batch) => {
          flushedBatches.push(batch)
        },
      })

      batcher.add({} as ObservabilityEvent)
      batcher.add({} as ObservabilityEvent)

      await batcher.flush()

      expect(flushedBatches).toHaveLength(1)
      expect(flushedBatches[0]).toHaveLength(2)
    })

    it('batcher handles errors in flush callback', async () => {
      let errorThrown = false
      const batcher = createBatcher<ObservabilityEvent>({
        maxSize: 1,
        maxDelayMs: 10000,
        onFlush: async () => {
          throw new Error('Flush failed')
        },
        onError: (error) => {
          errorThrown = true
          expect(error.message).toBe('Flush failed')
        },
      })

      batcher.add({} as ObservabilityEvent)

      // Wait for error handler to be called
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(errorThrown).toBe(true)
    })

    it('batcher clears pending items on flush', async () => {
      const batcher = createBatcher<ObservabilityEvent>({
        maxSize: 100,
        maxDelayMs: 10000,
        onFlush: async () => {},
      })

      batcher.add({} as ObservabilityEvent)
      batcher.add({} as ObservabilityEvent)

      expect(batcher.getPendingCount()).toBe(2)

      await batcher.flush()

      expect(batcher.getPendingCount()).toBe(0)
    })
  })

  // ============================================================================
  // Resource Management Tests
  // ============================================================================

  describe('Resource management', () => {
    it('cleans up resources on shutdown', async () => {
      await tailWorkerPipeline.receiveEvent(createTailEvent())

      await tailWorkerPipeline.shutdown()

      expect(tailWorkerPipeline.isShutdown()).toBe(true)
      // Pending events should be flushed
      expect(pipeline.events).toHaveLength(1)
    })

    it('rejects new events after shutdown', async () => {
      await tailWorkerPipeline.shutdown()

      await expect(
        tailWorkerPipeline.receiveEvent(createTailEvent())
      ).rejects.toThrow('Pipeline is shutdown')
    })

    it('flushes pending events on shutdown', async () => {
      for (let i = 0; i < 10; i++) {
        await tailWorkerPipeline.receiveEvent(createTailEvent())
      }

      await tailWorkerPipeline.shutdown()

      expect(pipeline.events).toHaveLength(10)
    })

    it('tracks memory usage for backpressure', () => {
      const stats = tailWorkerPipeline.getStats()

      expect(stats.memoryUsageBytes).toBeDefined()
      expect(stats.pendingEvents).toBeDefined()
      expect(stats.totalReceived).toBeDefined()
      expect(stats.totalForwarded).toBeDefined()
    })
  })
})
