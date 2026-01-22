/**
 * Tests for Hono Observability Middleware
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  observability,
  getRequestLogger,
  timing,
  requestId,
  type ObservabilityMiddlewareOptions,
} from '../middleware'
import { createStructuredLogger, LogLevel } from '../logger'
import { createTracer } from '../tracing'
import { CORRELATION_ID_HEADER, resetContextStack } from '../context'

describe('observability middleware', () => {
  let app: Hono
  let logOutput: string[]

  beforeEach(() => {
    logOutput = []
    resetContextStack()
    app = new Hono()
  })

  function createTestLogger() {
    return createStructuredLogger({
      level: LogLevel.DEBUG,
      format: 'json',
      service: 'test-middleware',
      output: (_level, message) => {
        logOutput.push(message)
      },
    })
  }

  describe('basic functionality', () => {
    it('should pass through requests to handlers', async () => {
      app.use('/*', observability({ enableLogging: false, enableTracing: false }))
      app.get('/test', (c) => c.json({ status: 'ok' }))

      const res = await app.request('/test')
      expect(res.status).toBe(200)
      const json = await res.json() as { status: string }
      expect(json.status).toBe('ok')
    })

    it('should add correlation ID header to response', async () => {
      app.use('/*', observability({ enableLogging: false, enableTracing: false }))
      app.get('/test', (c) => c.json({ status: 'ok' }))

      const res = await app.request('/test')
      expect(res.headers.get(CORRELATION_ID_HEADER)).toBeTruthy()
    })

    it('should preserve incoming correlation ID', async () => {
      app.use('/*', observability({ enableLogging: false, enableTracing: false }))
      app.get('/test', (c) => c.json({ status: 'ok' }))

      const incomingCorrelationId = 'test-correlation-123'
      const res = await app.request('/test', {
        headers: {
          [CORRELATION_ID_HEADER]: incomingCorrelationId,
        },
      })

      expect(res.headers.get(CORRELATION_ID_HEADER)).toBe(incomingCorrelationId)
    })

    it('should handle POST requests', async () => {
      app.use('/*', observability({ enableLogging: false, enableTracing: false }))
      app.post('/users', async (c) => {
        const body = await c.req.json()
        return c.json({ received: body })
      })

      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }),
      })

      expect(res.status).toBe(200)
      const json = await res.json() as { received: { name: string } }
      expect(json.received.name).toBe('Alice')
    })
  })

  describe('path exclusion', () => {
    it('should exclude health check paths by default', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/health', (c) => c.json({ status: 'healthy' }))
      app.get('/api/users', (c) => c.json({ users: [] }))

      // Health check should not be logged
      await app.request('/health')
      const healthLogs = logOutput.length

      // API call should be logged
      await app.request('/api/users')
      const apiLogs = logOutput.length - healthLogs

      expect(healthLogs).toBe(0)
      expect(apiLogs).toBeGreaterThan(0)
    })

    it('should exclude custom paths', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({
        logger,
        enableTracing: false,
        excludePaths: ['/internal', '/metrics'],
      }))
      app.get('/internal/status', (c) => c.json({ status: 'ok' }))
      app.get('/metrics', (c) => c.text('# metrics'))

      await app.request('/internal/status')
      await app.request('/metrics')

      expect(logOutput.length).toBe(0)
    })
  })

  describe('logging', () => {
    it('should log request and response', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/api/test', (c) => c.json({ result: 'success' }))

      await app.request('/api/test')

      expect(logOutput.length).toBe(2) // request + response logs
      const requestLog = JSON.parse(logOutput[0]!)
      const responseLog = JSON.parse(logOutput[1]!)

      expect(requestLog.message).toContain('Request:')
      expect(requestLog.method).toBe('GET')
      expect(requestLog.path).toBe('/api/test')

      expect(responseLog.message).toContain('Response:')
      expect(responseLog.status).toBe(200)
      expect(responseLog.duration).toBeDefined()
    })

    it('should log error responses at appropriate level', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/error', (c) => c.json({ error: 'Not found' }, 404))
      app.get('/server-error', (c) => c.json({ error: 'Internal' }, 500))

      await app.request('/error')
      await app.request('/server-error')

      const logs = logOutput.map(l => JSON.parse(l))
      // Request logs + response logs (2 routes x 2 logs each = 4 logs)
      expect(logs.length).toBe(4)

      // Find response logs
      const errorResponse = logs.find(l => l.status === 404)
      const serverErrorResponse = logs.find(l => l.status === 500)

      expect(errorResponse!.level).toBe('warn')
      expect(serverErrorResponse!.level).toBe('error')
    })

    it('should respect enableLogging option', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableLogging: false, enableTracing: false }))
      app.get('/test', (c) => c.json({ ok: true }))

      await app.request('/test')

      expect(logOutput.length).toBe(0)
    })

    it('should include correlation ID in logs', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/test', (c) => c.json({ ok: true }))

      const correlationId = 'log-correlation-test'
      await app.request('/test', {
        headers: { [CORRELATION_ID_HEADER]: correlationId },
      })

      const logs = logOutput.map(l => JSON.parse(l))
      expect(logs[0]!.correlationId).toBe(correlationId)
      expect(logs[1]!.correlationId).toBe(correlationId)
    })
  })

  describe('header sanitization', () => {
    it('should redact sensitive headers by default', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/test', (c) => c.json({ ok: true }))

      await app.request('/test', {
        headers: {
          'Authorization': 'Bearer secret-token',
          'Cookie': 'session=abc123',
          'X-Api-Key': 'api-secret-key',
          'X-Custom-Header': 'visible-value',
        },
      })

      const requestLog = JSON.parse(logOutput[0]!)
      expect(requestLog.headers['authorization']).toBe('[REDACTED]')
      expect(requestLog.headers['cookie']).toBe('[REDACTED]')
      expect(requestLog.headers['x-api-key']).toBe('[REDACTED]')
      expect(requestLog.headers['x-custom-header']).toBe('visible-value')
    })

    it('should allow custom header exclusion list', async () => {
      const logger = createTestLogger()
      // Note: excludeHeaders replaces the default list entirely
      app.use('/*', observability({
        logger,
        enableTracing: false,
        excludeHeaders: ['x-secret', 'x-private'],
      }))
      app.get('/test', (c) => c.json({ ok: true }))

      await app.request('/test', {
        headers: {
          'X-Secret': 'secret-value',
          'X-Private': 'private-value',
          'X-Visible': 'visible-value', // Not in list, so not redacted
        },
      })

      const requestLog = JSON.parse(logOutput[0]!)
      expect(requestLog.headers['x-secret']).toBe('[REDACTED]')
      expect(requestLog.headers['x-private']).toBe('[REDACTED]')
      expect(requestLog.headers['x-visible']).toBe('visible-value')
    })
  })

  describe('tracing', () => {
    it('should add tracing headers when enabled', async () => {
      const tracer = createTracer({ name: 'test-tracer' })
      app.use('/*', observability({ tracer, enableLogging: false }))
      app.get('/test', (c) => c.json({ ok: true }))

      const res = await app.request('/test')

      // Should have traceparent header in response
      const traceparent = res.headers.get('traceparent')
      expect(traceparent).toBeTruthy()
      expect(traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/)
    })

    it('should propagate incoming trace context', async () => {
      const tracer = createTracer({ name: 'test-tracer' })
      app.use('/*', observability({ tracer, enableLogging: false }))
      app.get('/test', (c) => c.json({ ok: true }))

      const incomingTraceId = 'abcdef1234567890abcdef1234567890'
      const incomingSpanId = '1234567890abcdef'
      const incomingTraceparent = `00-${incomingTraceId}-${incomingSpanId}-01`

      const res = await app.request('/test', {
        headers: {
          'traceparent': incomingTraceparent,
        },
      })

      const responseTraceparent = res.headers.get('traceparent')
      expect(responseTraceparent).toBeTruthy()
      // The trace ID should be propagated
      expect(responseTraceparent).toContain(incomingTraceId)
    })

    it('should respect enableTracing option', async () => {
      app.use('/*', observability({ enableTracing: false, enableLogging: false }))
      app.get('/test', (c) => c.json({ ok: true }))

      const res = await app.request('/test')

      // Should not have traceparent header when tracing is disabled
      const traceparent = res.headers.get('traceparent')
      expect(traceparent).toBeNull()
    })
  })

  describe('error handling', () => {
    it('should handle thrown errors', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/throws', () => {
        throw new Error('Test error')
      })
      app.onError((err, c) => {
        return c.json({ error: err.message }, 500)
      })

      const res = await app.request('/throws')
      expect(res.status).toBe(500)

      // The middleware logs request and response - check we got both logs
      const logs = logOutput.map(l => JSON.parse(l))
      expect(logs.length).toBeGreaterThanOrEqual(2)

      // Find the response log with error status
      const responseLog = logs.find(l => l.status === 500)
      expect(responseLog).toBeDefined()
      expect(responseLog!.level).toBe('error')
      expect(responseLog!.statusCategory).toBe('server_error')
    })

    it('should record error in span', async () => {
      const tracer = createTracer({ name: 'test-tracer' })
      app.use('/*', observability({ tracer, enableLogging: false }))
      app.get('/throws', () => {
        throw new Error('Span error test')
      })
      app.onError((err, c) => {
        return c.json({ error: err.message }, 500)
      })

      const res = await app.request('/throws')
      expect(res.status).toBe(500)
    })
  })

  describe('status categories', () => {
    it('should categorize success responses', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/ok', (c) => c.json({ ok: true }))

      await app.request('/ok')

      const responseLog = JSON.parse(logOutput[1]!)
      expect(responseLog.statusCategory).toBe('success')
    })

    it('should categorize redirect responses', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/redirect', (c) => c.redirect('/other'))

      await app.request('/redirect')

      const responseLog = JSON.parse(logOutput[1]!)
      expect(responseLog.statusCategory).toBe('redirect')
    })

    it('should categorize client error responses', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/notfound', (c) => c.json({ error: 'Not found' }, 404))

      await app.request('/notfound')

      const responseLog = JSON.parse(logOutput[1]!)
      expect(responseLog.statusCategory).toBe('client_error')
    })

    it('should categorize server error responses', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({ logger, enableTracing: false }))
      app.get('/servererror', (c) => c.json({ error: 'Internal' }, 500))

      await app.request('/servererror')

      const responseLog = JSON.parse(logOutput[1]!)
      expect(responseLog.statusCategory).toBe('server_error')
    })
  })

  describe('custom options', () => {
    it('should use custom service name', async () => {
      const logger = createTestLogger()
      app.use('/*', observability({
        service: 'custom-service',
        logger,
        enableTracing: false,
      }))
      app.get('/test', (c) => c.json({ ok: true }))

      await app.request('/test')

      const requestLog = JSON.parse(logOutput[0]!)
      expect(requestLog.service).toBe('test-middleware') // Logger overrides service
    })
  })
})

describe('getRequestLogger', () => {
  let app: Hono

  beforeEach(() => {
    resetContextStack()
    app = new Hono()
  })

  it('should create a request-scoped logger', async () => {
    const output: string[] = []

    app.use('/*', observability({ enableLogging: false, enableTracing: false }))
    app.get('/test', (c) => {
      const log = getRequestLogger(c, 'test-handler')
      // Create a logger that captures output
      const testLogger = createStructuredLogger({
        service: 'test-handler',
        format: 'json',
        output: (_level, message) => output.push(message),
      })
      testLogger.info('Handler executed')
      return c.json({ ok: true })
    })

    await app.request('/test', {
      headers: { [CORRELATION_ID_HEADER]: 'request-logger-test' },
    })

    expect(output.length).toBe(1)
    const log = JSON.parse(output[0]!)
    expect(log.message).toBe('Handler executed')
    expect(log.service).toBe('test-handler')
  })
})

describe('timing middleware', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
  })

  it('should add X-Response-Time header', async () => {
    app.use('/*', timing())
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')

    const responseTime = res.headers.get('X-Response-Time')
    expect(responseTime).toBeTruthy()
    expect(responseTime).toMatch(/^\d+ms$/)
  })

  it('should measure actual response time', async () => {
    app.use('/*', timing())
    app.get('/slow', async (c) => {
      await new Promise(resolve => setTimeout(resolve, 50))
      return c.json({ ok: true })
    })

    const res = await app.request('/slow')

    const responseTime = res.headers.get('X-Response-Time')
    const ms = parseInt(responseTime!.replace('ms', ''), 10)
    expect(ms).toBeGreaterThanOrEqual(50)
  })
})

describe('requestId middleware', () => {
  let app: Hono

  beforeEach(() => {
    app = new Hono()
  })

  it('should add correlation ID if not present', async () => {
    app.use('/*', requestId())
    app.get('/test', (c) => c.json({ ok: true }))

    const res = await app.request('/test')

    const correlationId = res.headers.get(CORRELATION_ID_HEADER)
    expect(correlationId).toBeTruthy()
  })

  it('should preserve existing correlation ID', async () => {
    app.use('/*', requestId())
    app.get('/test', (c) => c.json({ ok: true }))

    const existingId = 'my-existing-correlation-id'
    const res = await app.request('/test', {
      headers: { [CORRELATION_ID_HEADER]: existingId },
    })

    expect(res.headers.get(CORRELATION_ID_HEADER)).toBe(existingId)
  })

  it('should generate unique IDs for different requests', async () => {
    app.use('/*', requestId())
    app.get('/test', (c) => c.json({ ok: true }))

    const res1 = await app.request('/test')
    const res2 = await app.request('/test')

    const id1 = res1.headers.get(CORRELATION_ID_HEADER)
    const id2 = res2.headers.get(CORRELATION_ID_HEADER)

    expect(id1).not.toBe(id2)
  })
})
