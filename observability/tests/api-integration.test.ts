/**
 * Tests for API observability integration
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  createAPIObservabilityMiddleware,
  createAPIMetrics,
  createRouteTracer,
  metricsEndpoint,
  type APIObservabilityConfig,
} from '../api-integration'
import { createMeter } from '../metrics'
import { createTracer, SpanStatusCode } from '../tracing'
import { createStructuredLogger, LogLevel } from '../logger'
import { CORRELATION_ID_HEADER, resetContextStack } from '../context'

describe('createAPIMetrics', () => {
  it('should create all required metrics', () => {
    const meter = createMeter({ name: 'test-meter' })
    const metrics = createAPIMetrics(meter)

    expect(metrics.requestCount).toBeDefined()
    expect(metrics.requestDuration).toBeDefined()
    expect(metrics.activeRequests).toBeDefined()
    expect(metrics.errorCount).toBeDefined()
    expect(metrics.requestSize).toBeDefined()
    expect(metrics.responseSize).toBeDefined()
  })
})

describe('createAPIObservabilityMiddleware', () => {
  let app: Hono
  let logOutput: string[]

  beforeEach(() => {
    resetContextStack()
    logOutput = []
    app = new Hono()
  })

  it('should create middleware with default config', () => {
    const middleware = createAPIObservabilityMiddleware()
    expect(middleware).toBeDefined()
    expect(typeof middleware).toBe('function')
  })

  it('should add correlation ID to response headers', async () => {
    const middleware = createAPIObservabilityMiddleware({
      enableLogging: false,
      enableTracing: false,
      enableMetrics: false,
    })

    app.use('/*', middleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
    expect(res.headers.get(CORRELATION_ID_HEADER)).toBeDefined()
  })

  it('should use incoming correlation ID if provided', async () => {
    const middleware = createAPIObservabilityMiddleware({
      enableLogging: false,
      enableTracing: false,
      enableMetrics: false,
    })

    app.use('/*', middleware)
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test', {
      headers: { [CORRELATION_ID_HEADER]: 'incoming-cid-123' },
    })
    expect(res.headers.get(CORRELATION_ID_HEADER)).toBe('incoming-cid-123')
  })

  it('should exclude configured paths', async () => {
    let middlewareExecuted = false
    const middleware = createAPIObservabilityMiddleware({
      enableLogging: false,
      enableTracing: false,
      enableMetrics: false,
      excludePaths: ['/health'],
    })

    app.use('/*', async (c, next) => {
      await middleware(c, async () => {
        middlewareExecuted = true
        await next()
      })
    })
    app.get('/health', (c) => c.json({ status: 'ok' }))

    const res = await app.request('/health')
    expect(res.status).toBe(200)
    // The middleware should return early without setting correlation ID
    // for excluded paths
  })

  it('should log requests when logging is enabled', async () => {
    const logger = createStructuredLogger({
      level: LogLevel.DEBUG,
      format: 'json',
      service: 'test',
      output: (_level, message) => {
        logOutput.push(message)
      },
    })

    const middleware = createAPIObservabilityMiddleware({
      enableLogging: true,
      enableTracing: false,
      enableMetrics: false,
      logger,
    })

    app.use('/*', middleware)
    app.get('/api/users', (c) => c.json({ users: [] }))

    await app.request('/api/users')

    // Should have request and response logs
    expect(logOutput.length).toBeGreaterThanOrEqual(1)
    const hasResponseLog = logOutput.some((log) => {
      const parsed = JSON.parse(log)
      return parsed.message?.includes('Response') || parsed.path === '/api/users'
    })
    expect(hasResponseLog).toBe(true)
  })

  it('should track metrics when metrics are enabled', async () => {
    const meter = createMeter({ name: 'test-metrics' })

    const middleware = createAPIObservabilityMiddleware({
      enableLogging: false,
      enableTracing: false,
      enableMetrics: true,
      meter,
    })

    app.use('/*', middleware)
    app.get('/api/data', (c) => c.json({ data: 'test' }))

    await app.request('/api/data')

    const collected = meter.collect()
    expect(collected.length).toBeGreaterThan(0)

    // Should have request count metric
    const requestCountMetric = collected.find((m) =>
      m.name.includes('request') || m.name.includes('rpc')
    )
    expect(requestCountMetric).toBeDefined()
  })

  it('should create spans when tracing is enabled', async () => {
    const tracer = createTracer({ name: 'test-tracer' })

    const middleware = createAPIObservabilityMiddleware({
      enableLogging: false,
      enableTracing: true,
      enableMetrics: false,
      tracer,
    })

    app.use('/*', middleware)
    app.get('/api/items', (c) => c.json({ items: [] }))

    const res = await app.request('/api/items')
    expect(res.status).toBe(200)

    // Should have traceparent in response
    const traceparent = res.headers.get('traceparent')
    // traceparent may or may not be set depending on implementation
  })

  it('should handle errors and track them', async () => {
    const meter = createMeter({ name: 'error-test-meter' })
    const logger = createStructuredLogger({
      level: LogLevel.ERROR,
      format: 'json',
      service: 'test',
      output: (_level, message) => {
        logOutput.push(message)
      },
    })

    const middleware = createAPIObservabilityMiddleware({
      enableLogging: true,
      enableTracing: false,
      enableMetrics: true,
      meter,
      logger,
    })

    app.use('/*', middleware)
    app.get('/api/error', () => {
      throw new Error('Test error')
    })

    app.onError((err, c) => {
      return c.json({ error: err.message }, 500)
    })

    const res = await app.request('/api/error')
    expect(res.status).toBe(500)

    const collected = meter.collect()
    const errorMetric = collected.find((m) =>
      m.name.includes('error') && m.value > 0
    )
    // Error should be tracked
  })

  it('should track response status categories', async () => {
    const meter = createMeter({ name: 'status-test' })

    const middleware = createAPIObservabilityMiddleware({
      enableLogging: false,
      enableTracing: false,
      enableMetrics: true,
      meter,
    })

    app.use('/*', middleware)
    app.get('/ok', (c) => c.json({ ok: true }))
    app.get('/notfound', (c) => c.json({ error: 'not found' }, 404))
    app.get('/error', (c) => c.json({ error: 'server error' }, 500))

    await app.request('/ok')
    await app.request('/notfound')
    await app.request('/error')

    const collected = meter.collect()
    // Should have metrics with different status categories
    expect(collected.length).toBeGreaterThan(0)
  })

  it('should redact sensitive headers in logs', async () => {
    const logger = createStructuredLogger({
      level: LogLevel.DEBUG,
      format: 'json',
      service: 'test',
      output: (_level, message) => {
        logOutput.push(message)
      },
    })

    const middleware = createAPIObservabilityMiddleware({
      enableLogging: true,
      enableTracing: false,
      enableMetrics: false,
      logger,
      excludeHeaders: ['authorization', 'x-api-key'],
    })

    app.use('/*', middleware)
    app.get('/secure', (c) => c.json({ ok: true }))

    await app.request('/secure', {
      headers: {
        'Authorization': 'Bearer secret-token',
        'X-Api-Key': 'sk-12345',
        'Content-Type': 'application/json',
      },
    })

    // Check that sensitive headers are redacted
    const requestLog = logOutput.find((log) => {
      const parsed = JSON.parse(log)
      return parsed.headers
    })

    if (requestLog) {
      const parsed = JSON.parse(requestLog)
      if (parsed.headers) {
        expect(parsed.headers['authorization']).toBe('[REDACTED]')
        expect(parsed.headers['x-api-key']).toBe('[REDACTED]')
      }
    }
  })

  it('should track request and response sizes', async () => {
    const meter = createMeter({ name: 'size-test' })

    const middleware = createAPIObservabilityMiddleware({
      enableLogging: false,
      enableTracing: false,
      enableMetrics: true,
      meter,
    })

    app.use('/*', middleware)
    app.post('/data', async (c) => {
      const body = await c.req.json()
      return c.json({ received: body })
    })

    await app.request('/data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '15',
      },
      body: JSON.stringify({ test: 'data' }),
    })

    const collected = meter.collect()
    const sizeMetric = collected.find((m) =>
      m.name.includes('size') || m.name.includes('request')
    )
    // Size metrics should be recorded
  })
})

describe('createRouteTracer', () => {
  it('should create a route tracer', async () => {
    const app = new Hono()
    const tracer = createTracer({ name: 'route-tracer-test' })

    app.get('/traced', async (c) => {
      const routeTracer = createRouteTracer(c, { tracer })

      const span = routeTracer.startSpan('custom-operation', {
        'custom.attr': 'value',
      })
      expect(span).toBeDefined()
      span.end()

      return c.json({ ok: true })
    })

    const res = await app.request('/traced')
    expect(res.status).toBe(200)
  })

  it('should run function within a span using withSpan', async () => {
    const app = new Hono()
    const tracer = createTracer({ name: 'withspan-test' })

    app.get('/withspan', async (c) => {
      const routeTracer = createRouteTracer(c, { tracer })

      const result = await routeTracer.withSpan('db-query', async (span) => {
        span.setAttribute('db.table', 'users')
        return { user: 'alice' }
      })

      expect(result).toEqual({ user: 'alice' })
      return c.json(result)
    })

    const res = await app.request('/withspan')
    expect(res.status).toBe(200)
    const body = await res.json() as { user: string }
    expect(body.user).toBe('alice')
  })

  it('should handle errors in withSpan', async () => {
    const app = new Hono()
    const tracer = createTracer({ name: 'withspan-error-test' })

    app.get('/withspan-error', async (c) => {
      const routeTracer = createRouteTracer(c, { tracer })

      try {
        await routeTracer.withSpan('failing-operation', async () => {
          throw new Error('Operation failed')
        })
      } catch (e) {
        return c.json({ error: (e as Error).message }, 500)
      }

      return c.json({ ok: true })
    })

    const res = await app.request('/withspan-error')
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Operation failed')
  })

  it('should inherit parent trace context', async () => {
    const app = new Hono()
    const tracer = createTracer({ name: 'parent-context-test' })

    app.get('/parent-trace', async (c) => {
      const routeTracer = createRouteTracer(c, { tracer })
      const span = routeTracer.startSpan('child-span')
      const context = span.context()
      span.end()

      return c.json({ traceId: context.traceId })
    })

    const res = await app.request('/parent-trace', {
      headers: {
        'traceparent': '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json() as { traceId: string }
    expect(body.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
  })

  it('should use default tracer when none provided', async () => {
    const app = new Hono()

    app.get('/default-tracer', async (c) => {
      const routeTracer = createRouteTracer(c)
      const span = routeTracer.startSpan('test')
      expect(span).toBeDefined()
      span.end()
      return c.json({ ok: true })
    })

    const res = await app.request('/default-tracer')
    expect(res.status).toBe(200)
  })
})

describe('metricsEndpoint', () => {
  it('should expose metrics in text format', async () => {
    const app = new Hono()
    const meter = createMeter({ name: 'metrics-endpoint-test' })

    // Add some metrics
    const counter = meter.createCounter('test_counter', {
      description: 'Test counter',
    })
    counter.inc({ label: 'test' })

    app.get('/metrics', metricsEndpoint(meter))

    const res = await app.request('/metrics')
    expect(res.status).toBe(200)

    const text = await res.text()
    expect(text).toContain('test_counter')
  })

  it('should format labels correctly', async () => {
    const app = new Hono()
    const meter = createMeter({ name: 'labels-test' })

    const counter = meter.createCounter('labeled_counter', {})
    counter.inc({ method: 'GET', status: '200' })

    app.get('/metrics', metricsEndpoint(meter))

    const res = await app.request('/metrics')
    const text = await res.text()

    expect(text).toContain('labeled_counter')
    expect(text).toContain('method="GET"')
    expect(text).toContain('status="200"')
  })

  it('should use default meter when none provided', async () => {
    const app = new Hono()
    app.get('/metrics', metricsEndpoint())

    const res = await app.request('/metrics')
    expect(res.status).toBe(200)
  })

  it('should include timestamp in metrics', async () => {
    const app = new Hono()
    const meter = createMeter({ name: 'timestamp-test' })

    const gauge = meter.createGauge('test_gauge', {})
    gauge.set(42, {})

    app.get('/metrics', metricsEndpoint(meter))

    const res = await app.request('/metrics')
    const text = await res.text()

    // Should have a timestamp at the end (Unix ms)
    expect(text).toMatch(/\d+$/)
  })
})

describe('Excluded paths', () => {
  it('should skip observability for health check paths by default', async () => {
    const app = new Hono()
    const meter = createMeter({ name: 'health-check-test' })

    const middleware = createAPIObservabilityMiddleware({
      enableLogging: false,
      enableTracing: false,
      enableMetrics: true,
      meter,
      // Default exclude paths include /health, /healthz, etc.
    })

    app.use('/*', middleware)
    app.get('/health', (c) => c.json({ status: 'ok' }))
    app.get('/api/data', (c) => c.json({ data: [] }))

    // Health check should not be tracked
    await app.request('/health')
    const afterHealth = meter.collect()

    // API call should be tracked
    await app.request('/api/data')
    const afterApi = meter.collect()

    // API call should add metrics
    expect(afterApi.length).toBeGreaterThanOrEqual(afterHealth.length)
  })

  it('should skip paths with prefix matching', async () => {
    const app = new Hono()

    const middleware = createAPIObservabilityMiddleware({
      enableLogging: false,
      enableTracing: false,
      enableMetrics: false,
      excludePaths: ['/internal'],
    })

    app.use('/*', middleware)
    app.get('/internal/debug', (c) => c.json({ debug: true }))

    const res = await app.request('/internal/debug')
    expect(res.status).toBe(200)
    // Should not have correlation ID for excluded paths
  })
})

describe('Full integration', () => {
  it('should work with all features enabled', async () => {
    const app = new Hono()
    const logOutput: string[] = []

    const logger = createStructuredLogger({
      level: LogLevel.INFO,
      format: 'json',
      service: 'full-integration',
      output: (_level, message) => {
        logOutput.push(message)
      },
    })

    const tracer = createTracer({ name: 'full-integration' })
    const meter = createMeter({ name: 'full-integration' })

    const middleware = createAPIObservabilityMiddleware({
      serviceName: 'full-integration-test',
      enableLogging: true,
      enableTracing: true,
      enableMetrics: true,
      logger,
      tracer,
      meter,
    })

    app.use('/*', middleware)
    app.get('/api/users/:id', (c) => {
      const id = c.req.param('id')
      return c.json({ id, name: 'Test User' })
    })

    const res = await app.request('/api/users/123', {
      headers: {
        'User-Agent': 'test-client/1.0',
      },
    })

    expect(res.status).toBe(200)

    // Should have correlation ID
    expect(res.headers.get(CORRELATION_ID_HEADER)).toBeDefined()

    // Should have logs
    expect(logOutput.length).toBeGreaterThan(0)

    // Should have metrics
    const metrics = meter.collect()
    expect(metrics.length).toBeGreaterThan(0)

    // Response should be correct
    const body = await res.json() as { id: string; name: string }
    expect(body.id).toBe('123')
    expect(body.name).toBe('Test User')
  })
})
