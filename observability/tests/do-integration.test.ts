/**
 * Tests for Durable Object Observability Integration
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDOObservability,
  createDOMetrics,
  extractDOContextFromHeaders,
  injectDOContextToHeaders,
  createStorageTracker,
  type DOObservabilityConfig,
  type DOObservabilityContext,
} from '../do-integration'
import { createMeter } from '../metrics'
import { createStructuredLogger, LogLevel } from '../logger'

describe('createDOObservability', () => {
  describe('basic creation', () => {
    it('should create observability with default config', () => {
      const obs = createDOObservability()

      expect(obs.logger).toBeDefined()
      expect(obs.tracer).toBeDefined()
      expect(obs.meter).toBeDefined()
      expect(obs.metrics).toBeDefined()
    })

    it('should create observability with custom config', () => {
      const obs = createDOObservability({
        serviceName: 'custom-do',
        doId: 'test-do-id',
        doClassName: 'TestDO',
      })

      expect(obs.logger).toBeDefined()
      expect(obs.tracer).toBeDefined()
    })

    it('should handle DurableObjectId-like objects', () => {
      const doId = {
        toString(): string {
          return 'durable-object-id-string'
        },
      }

      const obs = createDOObservability({
        doId,
      })

      expect(obs).toBeDefined()
    })
  })

  describe('createRequestContext', () => {
    it('should create request context with generated correlation ID', () => {
      const obs = createDOObservability()
      const ctx = obs.createRequestContext()

      expect(ctx.correlationId).toBeDefined()
      expect(ctx.correlationId.length).toBeGreaterThan(0)
      expect(ctx.logger).toBeDefined()
      expect(ctx.tracer).toBeDefined()
      expect(ctx.meter).toBeDefined()
    })

    it('should create request context with provided correlation ID', () => {
      const obs = createDOObservability()
      const correlationId = 'provided-correlation-id'
      const ctx = obs.createRequestContext(correlationId)

      expect(ctx.correlationId).toBe(correlationId)
    })

    it('should create request context with parent trace context', () => {
      const obs = createDOObservability()
      const parentTraceContext = {
        traceId: 'abcdef1234567890abcdef1234567890',
        spanId: '1234567890abcdef',
        traceFlags: 1,
      }

      const ctx = obs.createRequestContext('test-cid', parentTraceContext)

      expect(ctx.traceContext).toBeDefined()
      expect(ctx.traceContext!.traceId).toBe(parentTraceContext.traceId)
      expect(ctx.traceContext!.spanId).toBe(parentTraceContext.spanId)
    })
  })

  describe('wrapMethod', () => {
    it('should wrap synchronous methods', async () => {
      const obs = createDOObservability({
        doId: 'wrap-test',
        enableLogging: false,
      })
      const ctx = obs.createRequestContext('wrap-test-cid')

      const result = await obs.wrapMethod('testSync', () => {
        return 'sync-result'
      }, ctx)

      expect(result).toBe('sync-result')
    })

    it('should wrap async methods', async () => {
      const obs = createDOObservability({
        doId: 'wrap-async-test',
        enableLogging: false,
      })
      const ctx = obs.createRequestContext('wrap-async-cid')

      const result = await obs.wrapMethod('testAsync', async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'async-result'
      }, ctx)

      expect(result).toBe('async-result')
    })

    it('should propagate errors from wrapped methods', async () => {
      const obs = createDOObservability({
        doId: 'wrap-error-test',
        enableLogging: false,
      })
      const ctx = obs.createRequestContext('wrap-error-cid')

      await expect(
        obs.wrapMethod('testError', () => {
          throw new Error('Method failed')
        }, ctx)
      ).rejects.toThrow('Method failed')
    })

    it('should track request count metric', async () => {
      const obs = createDOObservability({
        doId: 'metric-test',
        enableMetrics: true,
        enableLogging: false,
        enableTracing: false,
      })

      await obs.wrapMethod('counted', () => 'result')
      await obs.wrapMethod('counted', () => 'result')

      const metrics = obs.meter.collect()
      const requestMetric = metrics.find(m => m.name === 'rpc.request.count')
      expect(requestMetric).toBeDefined()
    })

    it('should track request duration metric', async () => {
      const obs = createDOObservability({
        doId: 'duration-test',
        enableMetrics: true,
        enableLogging: false,
        enableTracing: false,
      })

      await obs.wrapMethod('timed', async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'timed-result'
      })

      const metrics = obs.meter.collect()
      const durationMetric = metrics.find(m => m.name === 'do.request.duration')
      expect(durationMetric).toBeDefined()
    })

    it('should track error count on failure', async () => {
      const obs = createDOObservability({
        doId: 'error-metric-test',
        enableMetrics: true,
        enableLogging: false,
        enableTracing: false,
      })

      try {
        await obs.wrapMethod('failing', () => {
          throw new Error('Test error')
        })
      } catch {
        // Expected error
      }

      const metrics = obs.meter.collect()
      const errorMetric = metrics.find(m => m.name === 'rpc.error.count')
      expect(errorMetric).toBeDefined()
    })

    it('should respect enableMetrics option', async () => {
      const obs = createDOObservability({
        doId: 'no-metrics-test',
        enableMetrics: false,
        enableLogging: false,
        enableTracing: false,
      })

      await obs.wrapMethod('notCounted', () => 'result')

      const metrics = obs.meter.collect()
      expect(metrics.length).toBe(0)
    })

    it('should respect enableTracing option', async () => {
      const obs = createDOObservability({
        doId: 'no-tracing-test',
        enableMetrics: false,
        enableLogging: false,
        enableTracing: false,
      })

      // Should not create spans when tracing is disabled
      await obs.wrapMethod('notTraced', () => 'result')
      expect(obs.tracer.getActiveSpan()).toBeUndefined()
    })
  })

  describe('trackStorageOperation', () => {
    it('should track get operations', () => {
      const obs = createDOObservability({
        doId: 'storage-get-test',
        enableMetrics: true,
      })

      obs.trackStorageOperation('get', { key: 'users/123' })

      const metrics = obs.meter.collect()
      const storageMetric = metrics.find(m => m.name === 'do.storage.operations')
      expect(storageMetric).toBeDefined()
    })

    it('should track put operations', () => {
      const obs = createDOObservability({
        doId: 'storage-put-test',
        enableMetrics: true,
      })

      obs.trackStorageOperation('put', { key: 'users/456' })

      const metrics = obs.meter.collect()
      const storageMetric = metrics.find(m => m.name === 'do.storage.operations')
      expect(storageMetric).toBeDefined()
    })

    it('should track delete operations', () => {
      const obs = createDOObservability({
        doId: 'storage-delete-test',
        enableMetrics: true,
      })

      obs.trackStorageOperation('delete')

      const metrics = obs.meter.collect()
      const storageMetric = metrics.find(m => m.name === 'do.storage.operations')
      expect(storageMetric).toBeDefined()
    })

    it('should respect enableMetrics option for storage operations', () => {
      const obs = createDOObservability({
        doId: 'no-storage-metrics',
        enableMetrics: false,
      })

      obs.trackStorageOperation('get')

      const metrics = obs.meter.collect()
      expect(metrics.length).toBe(0)
    })
  })

  describe('trackAlarmExecution', () => {
    it('should track successful alarm execution', () => {
      const logOutput: string[] = []
      const logger = createStructuredLogger({
        service: 'alarm-test',
        level: LogLevel.DEBUG,
        format: 'json',
        output: (_level, message) => logOutput.push(message),
      })

      // Create observability without injecting custom logger for metrics
      const obs = createDOObservability({
        doId: 'alarm-success-test',
        enableMetrics: true,
        enableLogging: true,
      })

      obs.trackAlarmExecution(true, 100)

      const metrics = obs.meter.collect()
      const alarmMetric = metrics.find(m => m.name === 'do.alarm.executions')
      expect(alarmMetric).toBeDefined()
    })

    it('should track failed alarm execution', () => {
      const obs = createDOObservability({
        doId: 'alarm-fail-test',
        enableMetrics: true,
        enableLogging: false,
      })

      obs.trackAlarmExecution(false, 50)

      const metrics = obs.meter.collect()
      const alarmMetric = metrics.find(m => m.name === 'do.alarm.executions')
      expect(alarmMetric).toBeDefined()
    })
  })

  describe('updateWebSocketCount', () => {
    it('should track WebSocket connection increases', () => {
      const obs = createDOObservability({
        doId: 'ws-connect-test',
        enableMetrics: true,
      })

      obs.updateWebSocketCount(1)
      obs.updateWebSocketCount(1)

      const metrics = obs.meter.collect()
      const wsMetric = metrics.find(m => m.name === 'do.websocket.connections')
      expect(wsMetric).toBeDefined()
      expect(wsMetric!.value).toBe(2)
    })

    it('should track WebSocket connection decreases', () => {
      const obs = createDOObservability({
        doId: 'ws-disconnect-test',
        enableMetrics: true,
      })

      obs.updateWebSocketCount(5)
      obs.updateWebSocketCount(-2)

      const metrics = obs.meter.collect()
      const wsMetric = metrics.find(m => m.name === 'do.websocket.connections')
      expect(wsMetric!.value).toBe(3)
    })
  })
})

describe('createDOMetrics', () => {
  it('should create all DO metrics', () => {
    const meter = createMeter({ name: 'do-metrics-test' })
    const metrics = createDOMetrics(meter)

    expect(metrics.requestCount).toBeDefined()
    expect(metrics.requestDuration).toBeDefined()
    expect(metrics.errorCount).toBeDefined()
    expect(metrics.storageOperations).toBeDefined()
    expect(metrics.alarmExecutions).toBeDefined()
    expect(metrics.websocketConnections).toBeDefined()
  })

  it('should allow incrementing request count', () => {
    const meter = createMeter({ name: 'do-metrics-count-test' })
    const metrics = createDOMetrics(meter)

    metrics.requestCount.inc({ method: 'fetch' })
    metrics.requestCount.inc({ method: 'fetch' })
    metrics.requestCount.inc({ method: 'alarm' })

    expect(metrics.requestCount.getValue({ method: 'fetch' })).toBe(2)
    expect(metrics.requestCount.getValue({ method: 'alarm' })).toBe(1)
  })

  it('should allow recording request duration', () => {
    const meter = createMeter({ name: 'do-metrics-duration-test' })
    const metrics = createDOMetrics(meter)

    metrics.requestDuration.record(50)
    metrics.requestDuration.record(100)
    metrics.requestDuration.record(200)

    const data = metrics.requestDuration.getData()
    expect(data).toBeDefined()
    expect(data!.count).toBe(3)
    expect(data!.sum).toBe(350)
  })

  it('should allow setting WebSocket connections gauge', () => {
    const meter = createMeter({ name: 'do-metrics-ws-test' })
    const metrics = createDOMetrics(meter)

    metrics.websocketConnections.set(10)
    expect(metrics.websocketConnections.getValue()).toBe(10)

    metrics.websocketConnections.add(-3)
    expect(metrics.websocketConnections.getValue()).toBe(7)
  })
})

describe('extractDOContextFromHeaders', () => {
  it('should extract correlation ID from headers', () => {
    const headers = new Headers()
    headers.set('x-correlation-id', 'extracted-correlation-id')

    const context = extractDOContextFromHeaders(headers)

    expect(context.correlationId).toBe('extracted-correlation-id')
  })

  it('should extract trace context from traceparent header', () => {
    const headers = new Headers()
    headers.set('traceparent', '00-abcdef1234567890abcdef1234567890-1234567890abcdef-01')

    const context = extractDOContextFromHeaders(headers)

    expect(context.traceContext).toBeDefined()
    expect(context.traceContext!.traceId).toBe('abcdef1234567890abcdef1234567890')
    expect(context.traceContext!.spanId).toBe('1234567890abcdef')
    expect(context.traceContext!.traceFlags).toBe(1)
  })

  it('should extract both correlation ID and trace context', () => {
    const headers = new Headers()
    headers.set('x-correlation-id', 'both-test-id')
    headers.set('traceparent', '00-fedcba0987654321fedcba0987654321-abcdef1234567890-00')

    const context = extractDOContextFromHeaders(headers)

    expect(context.correlationId).toBe('both-test-id')
    expect(context.traceContext).toBeDefined()
    expect(context.traceContext!.traceFlags).toBe(0)
  })

  it('should return empty context when no relevant headers', () => {
    const headers = new Headers()
    headers.set('content-type', 'application/json')

    const context = extractDOContextFromHeaders(headers)

    expect(context.correlationId).toBeUndefined()
    expect(context.traceContext).toBeUndefined()
  })

  it('should handle invalid traceparent gracefully', () => {
    const headers = new Headers()
    headers.set('traceparent', 'invalid-trace-parent')

    const context = extractDOContextFromHeaders(headers)

    expect(context.traceContext).toBeUndefined()
  })
})

describe('injectDOContextToHeaders', () => {
  it('should inject correlation ID into headers', () => {
    const headers = new Headers()
    const context: DOObservabilityContext = {
      correlationId: 'injected-correlation-id',
      logger: createStructuredLogger({ service: 'test' }),
      tracer: createDOObservability().tracer,
      meter: createMeter({ name: 'test' }),
    }

    injectDOContextToHeaders(headers, context)

    expect(headers.get('x-correlation-id')).toBe('injected-correlation-id')
  })

  it('should inject trace context as traceparent', () => {
    const headers = new Headers()
    const context: DOObservabilityContext = {
      correlationId: 'trace-inject-test',
      logger: createStructuredLogger({ service: 'test' }),
      tracer: createDOObservability().tracer,
      meter: createMeter({ name: 'test' }),
      traceContext: {
        traceId: '11111111111111111111111111111111',
        spanId: '2222222222222222',
        traceFlags: 1,
      },
    }

    injectDOContextToHeaders(headers, context)

    expect(headers.get('traceparent')).toBe('00-11111111111111111111111111111111-2222222222222222-01')
  })

  it('should not inject traceparent when no trace context', () => {
    const headers = new Headers()
    const context: DOObservabilityContext = {
      correlationId: 'no-trace-test',
      logger: createStructuredLogger({ service: 'test' }),
      tracer: createDOObservability().tracer,
      meter: createMeter({ name: 'test' }),
    }

    injectDOContextToHeaders(headers, context)

    expect(headers.get('x-correlation-id')).toBe('no-trace-test')
    expect(headers.get('traceparent')).toBeNull()
  })

  it('should format trace flags as two hex digits', () => {
    const headers = new Headers()
    const context: DOObservabilityContext = {
      correlationId: 'flags-test',
      logger: createStructuredLogger({ service: 'test' }),
      tracer: createDOObservability().tracer,
      meter: createMeter({ name: 'test' }),
      traceContext: {
        traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        spanId: 'bbbbbbbbbbbbbbbb',
        traceFlags: 0,
      },
    }

    injectDOContextToHeaders(headers, context)

    expect(headers.get('traceparent')).toBe('00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-00')
  })
})

describe('createStorageTracker', () => {
  it('should track get operations with key prefix', () => {
    const obs = createDOObservability({
      doId: 'storage-tracker-get',
      enableMetrics: true,
    })
    const tracker = createStorageTracker(obs)

    tracker.trackGet('users/123')
    tracker.trackGet('users/456')
    tracker.trackGet('orders/789')

    const metrics = obs.meter.collect()
    const storageMetrics = metrics.filter(m => m.name === 'do.storage.operations')
    expect(storageMetrics.length).toBeGreaterThan(0)
  })

  it('should track put operations', () => {
    const obs = createDOObservability({
      doId: 'storage-tracker-put',
      enableMetrics: true,
    })
    const tracker = createStorageTracker(obs)

    tracker.trackPut('data/key1')

    const metrics = obs.meter.collect()
    const storageMetric = metrics.find(m =>
      m.name === 'do.storage.operations' &&
      m.attributes['storage.operation'] === 'put'
    )
    expect(storageMetric).toBeDefined()
  })

  it('should track delete operations', () => {
    const obs = createDOObservability({
      doId: 'storage-tracker-delete',
      enableMetrics: true,
    })
    const tracker = createStorageTracker(obs)

    tracker.trackDelete('temp/data')

    const metrics = obs.meter.collect()
    const storageMetric = metrics.find(m =>
      m.name === 'do.storage.operations' &&
      m.attributes['storage.operation'] === 'delete'
    )
    expect(storageMetric).toBeDefined()
  })

  it('should track list operations with optional prefix', () => {
    const obs = createDOObservability({
      doId: 'storage-tracker-list',
      enableMetrics: true,
    })
    const tracker = createStorageTracker(obs)

    tracker.trackList('users/')
    tracker.trackList()

    const metrics = obs.meter.collect()
    const listMetrics = metrics.filter(m =>
      m.name === 'do.storage.operations' &&
      m.attributes['storage.operation'] === 'list'
    )
    expect(listMetrics.length).toBe(2)
  })

  it('should track transaction operations with operation count', () => {
    const obs = createDOObservability({
      doId: 'storage-tracker-tx',
      enableMetrics: true,
    })
    const tracker = createStorageTracker(obs)

    tracker.trackTransaction(5)

    const metrics = obs.meter.collect()
    const txMetric = metrics.find(m =>
      m.name === 'do.storage.operations' &&
      m.attributes['storage.operation'] === 'transaction'
    )
    expect(txMetric).toBeDefined()
    expect(txMetric!.attributes['storage.operation_count']).toBe(5)
  })

  it('should handle keys without slashes', () => {
    const obs = createDOObservability({
      doId: 'storage-tracker-no-slash',
      enableMetrics: true,
    })
    const tracker = createStorageTracker(obs)

    tracker.trackGet('simplekey')

    const metrics = obs.meter.collect()
    const storageMetric = metrics.find(m =>
      m.name === 'do.storage.operations' &&
      m.attributes['storage.key_prefix'] === 'simplekey'
    )
    expect(storageMetric).toBeDefined()
  })
})

describe('DO observability integration scenarios', () => {
  it('should support full request lifecycle', async () => {
    const obs = createDOObservability({
      serviceName: 'test-do-service',
      doId: 'lifecycle-test',
      doClassName: 'TestDurableObject',
      enableMetrics: true,
      enableTracing: true,
      enableLogging: false,
    })

    // Simulate incoming request with context
    const headers = new Headers()
    headers.set('x-correlation-id', 'lifecycle-correlation')
    headers.set('traceparent', '00-00000000000000000000000000000001-0000000000000001-01')

    const incomingContext = extractDOContextFromHeaders(headers)
    const ctx = obs.createRequestContext(
      incomingContext.correlationId,
      incomingContext.traceContext
    )

    // Execute method with observability
    const result = await obs.wrapMethod('fetch', async () => {
      // Simulate storage operations
      obs.trackStorageOperation('get', { key: 'data' })

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 5))

      return { status: 'ok' }
    }, ctx)

    expect(result.status).toBe('ok')

    // Prepare response headers
    const responseHeaders = new Headers()
    injectDOContextToHeaders(responseHeaders, ctx)

    expect(responseHeaders.get('x-correlation-id')).toBe('lifecycle-correlation')

    // Check metrics were recorded
    const metrics = obs.meter.collect()
    expect(metrics.length).toBeGreaterThan(0)
  })

  it('should handle WebSocket lifecycle', () => {
    const obs = createDOObservability({
      doId: 'websocket-lifecycle',
      enableMetrics: true,
    })

    // Simulate connections
    obs.updateWebSocketCount(1) // User 1 connects
    obs.updateWebSocketCount(1) // User 2 connects
    obs.updateWebSocketCount(1) // User 3 connects

    let metrics = obs.meter.collect()
    let wsMetric = metrics.find(m => m.name === 'do.websocket.connections')
    expect(wsMetric!.value).toBe(3)

    // Simulate disconnection
    obs.updateWebSocketCount(-1)

    metrics = obs.meter.collect()
    wsMetric = metrics.find(m => m.name === 'do.websocket.connections')
    expect(wsMetric!.value).toBe(2)
  })

  it('should handle alarm execution', async () => {
    const obs = createDOObservability({
      doId: 'alarm-lifecycle',
      enableMetrics: true,
      enableLogging: false,
    })

    const startTime = Date.now()

    // Simulate successful alarm
    await obs.wrapMethod('alarm', async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return null
    })

    const duration = Date.now() - startTime
    obs.trackAlarmExecution(true, duration)

    const metrics = obs.meter.collect()
    const alarmMetric = metrics.find(m => m.name === 'do.alarm.executions')
    expect(alarmMetric).toBeDefined()
  })
})
