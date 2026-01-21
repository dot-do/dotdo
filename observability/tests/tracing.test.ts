/**
 * Tests for distributed tracing
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateTraceId,
  generateSpanId,
  SpanStatusCode,
  SpanKind,
  createTracer,
  getTracer,
  setGlobalTracer,
  parseTraceparent,
  formatTraceparent,
  extractTraceContext,
  injectTraceContext,
  createConsoleExporter,
  createBatchSpanProcessor,
  instrument,
  type Tracer,
  type Span,
} from '../tracing'

describe('ID generation', () => {
  describe('generateTraceId', () => {
    it('should generate a 32-character hex string', () => {
      const traceId = generateTraceId()
      expect(traceId).toHaveLength(32)
      expect(traceId).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()))
      expect(ids.size).toBe(100)
    })
  })

  describe('generateSpanId', () => {
    it('should generate a 16-character hex string', () => {
      const spanId = generateSpanId()
      expect(spanId).toHaveLength(16)
      expect(spanId).toMatch(/^[a-f0-9]{16}$/)
    })

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateSpanId()))
      expect(ids.size).toBe(100)
    })
  })
})

describe('W3C Trace Context', () => {
  describe('parseTraceparent', () => {
    it('should parse valid traceparent header', () => {
      const header = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
      const context = parseTraceparent(header)
      expect(context).not.toBeNull()
      expect(context!.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
      expect(context!.spanId).toBe('b7ad6b7169203331')
      expect(context!.traceFlags).toBe(1)
    })

    it('should parse traceparent with sampled flag = 0', () => {
      const header = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00'
      const context = parseTraceparent(header)
      expect(context!.traceFlags).toBe(0)
    })

    it('should return null for invalid format', () => {
      expect(parseTraceparent('')).toBeNull()
      expect(parseTraceparent('invalid')).toBeNull()
      expect(parseTraceparent('00-invalid-b7ad6b7169203331-01')).toBeNull()
      expect(parseTraceparent('01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')).toBeNull()
    })
  })

  describe('formatTraceparent', () => {
    it('should format span context as traceparent header', () => {
      const context = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      }
      const header = formatTraceparent(context)
      expect(header).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
    })

    it('should handle traceFlags = 0', () => {
      const context = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 0,
      }
      const header = formatTraceparent(context)
      expect(header).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00')
    })
  })

  describe('extractTraceContext', () => {
    it('should extract from Headers object', () => {
      const headers = new Headers()
      headers.set('traceparent', '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
      headers.set('tracestate', 'vendor=value')

      const context = extractTraceContext(headers)
      expect(context).not.toBeNull()
      expect(context!.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
      expect(context!.traceState).toBe('vendor=value')
    })

    it('should extract from plain object', () => {
      const headers = {
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      }

      const context = extractTraceContext(headers)
      expect(context).not.toBeNull()
      expect(context!.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
    })

    it('should return null when traceparent is missing', () => {
      expect(extractTraceContext(new Headers())).toBeNull()
      expect(extractTraceContext({})).toBeNull()
    })
  })

  describe('injectTraceContext', () => {
    it('should inject trace context into headers', () => {
      const headers = new Headers()
      const context = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
        traceState: 'vendor=value',
      }

      injectTraceContext(headers, context)

      expect(headers.get('traceparent')).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
      expect(headers.get('tracestate')).toBe('vendor=value')
    })
  })
})

describe('Tracer', () => {
  let tracer: Tracer

  beforeEach(() => {
    tracer = createTracer({ name: 'test-tracer' })
  })

  describe('createTracer', () => {
    it('should create a tracer with a name', () => {
      expect(tracer.getName()).toBe('test-tracer')
    })
  })

  describe('startSpan', () => {
    it('should create a new span', () => {
      const span = tracer.startSpan('test-span')
      expect(span).toBeDefined()
      expect(span.getName()).toBe('test-span')
      expect(span.isRecording()).toBe(true)
    })

    it('should generate trace and span IDs', () => {
      const span = tracer.startSpan('test-span')
      const context = span.context()
      expect(context.traceId).toHaveLength(32)
      expect(context.spanId).toHaveLength(16)
      expect(context.traceFlags).toBe(1)
    })

    it('should respect parent context', () => {
      const parentContext = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      }

      const span = tracer.startSpan('child-span', { parent: parentContext })
      const context = span.context()
      expect(context.traceId).toBe(parentContext.traceId)
      expect(context.spanId).not.toBe(parentContext.spanId)
    })

    it('should support span kind', () => {
      const span = tracer.startSpan('server-span', { kind: SpanKind.SERVER })
      const data = span.toJSON()
      expect(data.kind).toBe(SpanKind.SERVER)
    })

    it('should support initial attributes', () => {
      const span = tracer.startSpan('attributed-span', {
        attributes: { 'http.method': 'GET', 'http.url': '/api/users' },
      })
      const data = span.toJSON()
      expect(data.attributes['http.method']).toBe('GET')
      expect(data.attributes['http.url']).toBe('/api/users')
    })
  })

  describe('Span', () => {
    let span: Span

    beforeEach(() => {
      span = tracer.startSpan('test-span')
    })

    it('should set and get name', () => {
      span.setName('renamed-span')
      expect(span.getName()).toBe('renamed-span')
    })

    it('should set attributes', () => {
      span.setAttribute('key', 'value')
      const data = span.toJSON()
      expect(data.attributes['key']).toBe('value')
    })

    it('should set multiple attributes', () => {
      span.setAttributes({ key1: 'value1', key2: 'value2' })
      const data = span.toJSON()
      expect(data.attributes['key1']).toBe('value1')
      expect(data.attributes['key2']).toBe('value2')
    })

    it('should add events', () => {
      span.addEvent('event-1', { detail: 'info' })
      const data = span.toJSON()
      expect(data.events).toHaveLength(1)
      expect(data.events[0]!.name).toBe('event-1')
      expect(data.events[0]!.attributes!['detail']).toBe('info')
    })

    it('should set status', () => {
      span.setStatus({ code: SpanStatusCode.OK })
      let data = span.toJSON()
      expect(data.status.code).toBe(SpanStatusCode.OK)

      span.setStatus({ code: SpanStatusCode.ERROR, message: 'Something went wrong' })
      data = span.toJSON()
      expect(data.status.code).toBe(SpanStatusCode.ERROR)
      expect(data.status.message).toBe('Something went wrong')
    })

    it('should record exceptions', () => {
      const error = new Error('Test error')
      span.recordException(error)
      const data = span.toJSON()

      expect(data.events).toHaveLength(1)
      expect(data.events[0]!.name).toBe('exception')
      expect(data.events[0]!.attributes!['exception.type']).toBe('Error')
      expect(data.events[0]!.attributes!['exception.message']).toBe('Test error')
      expect(data.status.code).toBe(SpanStatusCode.ERROR)
    })

    it('should track end time and duration', () => {
      expect(span.isEnded()).toBe(false)
      span.end()
      expect(span.isEnded()).toBe(true)

      const data = span.toJSON()
      expect(data.endTime).toBeDefined()
      expect(data.duration).toBeGreaterThanOrEqual(0)
    })

    it('should add links', () => {
      span.addLink({
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        attributes: { relationship: 'caused-by' },
      })
      const data = span.toJSON()
      expect(data.links).toHaveLength(1)
      expect(data.links[0]!.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
    })

    it('should be chainable', () => {
      const result = span
        .setName('chained')
        .setAttribute('key', 'value')
        .addEvent('event')
        .setStatus({ code: SpanStatusCode.OK })

      expect(result).toBe(span)
    })
  })

  describe('startActiveSpan', () => {
    it('should set the active span during execution', () => {
      const result = tracer.startActiveSpan('active-span', (span) => {
        expect(tracer.getActiveSpan()).toBe(span)
        return 'result'
      })

      expect(result).toBe('result')
      expect(tracer.getActiveSpan()).toBeUndefined()
    })

    it('should auto-end span on completion', () => {
      let capturedSpan: Span | undefined

      tracer.startActiveSpan('auto-end-span', (span) => {
        capturedSpan = span
        expect(span.isEnded()).toBe(false)
      })

      expect(capturedSpan!.isEnded()).toBe(true)
      expect(capturedSpan!.toJSON().status.code).toBe(SpanStatusCode.OK)
    })

    it('should handle errors and set error status', () => {
      let capturedSpan: Span | undefined

      expect(() => {
        tracer.startActiveSpan('error-span', (span) => {
          capturedSpan = span
          throw new Error('Test error')
        })
      }).toThrow('Test error')

      expect(capturedSpan!.isEnded()).toBe(true)
      expect(capturedSpan!.toJSON().status.code).toBe(SpanStatusCode.ERROR)
    })

    it('should handle async functions', async () => {
      let capturedSpan: Span | undefined

      const result = await tracer.startActiveSpan('async-span', async (span) => {
        capturedSpan = span
        await new Promise(resolve => setTimeout(resolve, 10))
        return 'async-result'
      })

      expect(result).toBe('async-result')
      expect(capturedSpan!.isEnded()).toBe(true)
    })

    it('should create parent-child hierarchy', () => {
      let parentSpanId: string
      let childParentSpanId: string | undefined

      tracer.startActiveSpan('parent', (parent) => {
        parentSpanId = parent.context().spanId

        tracer.startActiveSpan('child', (child) => {
          childParentSpanId = child.toJSON().parentSpanId
        })
      })

      expect(childParentSpanId).toBe(parentSpanId!)
    })
  })

  describe('withTrace', () => {
    it('should set a specific trace ID', () => {
      const traceId = '0af7651916cd43dd8448eb211c80319c'
      tracer.withTrace(traceId)
      const span = tracer.startSpan('test')
      expect(span.context().traceId).toBe(traceId)
    })
  })
})

describe('Global tracer', () => {
  it('should provide a default global tracer', () => {
    const tracer = getTracer()
    expect(tracer).toBeDefined()
    expect(tracer.getName()).toBe('dotdo')
  })

  it('should allow setting a custom global tracer', () => {
    const customTracer = createTracer({ name: 'custom' })
    setGlobalTracer(customTracer)
    expect(getTracer().getName()).toBe('custom')

    // Reset
    setGlobalTracer(createTracer({ name: 'dotdo' }))
  })
})

describe('instrument', () => {
  it('should wrap a function with automatic span creation', () => {
    const tracer = createTracer({ name: 'instrument-test' })
    let spanName: string | undefined

    const fn = (...args: unknown[]) => {
      const span = tracer.getActiveSpan()
      spanName = span?.getName()
      const [x, y] = args as [number, number]
      return x + y
    }

    const instrumented = instrument('add', fn, { tracer })
    const result = instrumented(2, 3)

    expect(result).toBe(5)
    expect(spanName).toBe('add')
  })
})

describe('SpanExporter', () => {
  describe('createConsoleExporter', () => {
    it('should export spans without error', async () => {
      const exporter = createConsoleExporter()
      const tracer = createTracer({ name: 'export-test' })
      const span = tracer.startSpan('test-span')
      span.end()

      await expect(exporter.export([span.toJSON()])).resolves.not.toThrow()
      await expect(exporter.shutdown()).resolves.not.toThrow()
    })
  })
})

describe('SpanProcessor', () => {
  describe('createBatchSpanProcessor', () => {
    it('should batch spans for export', async () => {
      const exported: any[] = []
      const exporter = {
        async export(spans: any[]) {
          exported.push(...spans)
        },
        async shutdown() {},
      }

      const processor = createBatchSpanProcessor(exporter, {
        scheduledDelayMs: 10,
        maxExportBatchSize: 100,
      })

      const tracer = createTracer({ name: 'batch-test' })
      const span = tracer.startSpan('test')
      span.end()

      processor.onEnd(span)

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(exported.length).toBeGreaterThan(0)

      await processor.shutdown()
    })

    it('should force flush on demand', async () => {
      const exported: any[] = []
      const exporter = {
        async export(spans: any[]) {
          exported.push(...spans)
        },
        async shutdown() {},
      }

      const processor = createBatchSpanProcessor(exporter, {
        scheduledDelayMs: 10000, // Long delay
      })

      const tracer = createTracer({ name: 'force-flush-test' })
      const span = tracer.startSpan('test')
      span.end()

      processor.onEnd(span)

      // Force flush immediately
      await processor.forceFlush()

      expect(exported.length).toBe(1)

      await processor.shutdown()
    })
  })
})
