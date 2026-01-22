/**
 * Distributed Tracing for dotdo
 *
 * Provides W3C Trace Context compatible distributed tracing with:
 * - Trace and span creation/management
 * - Automatic timing and duration tracking
 * - Span hierarchies (parent-child relationships)
 * - Attributes and events on spans
 * - Span status (ok, error, unset)
 * - Baggage propagation
 *
 * @module observability/tracing
 */

import { createStructuredLogger, type LogContext } from './logger'

/**
 * Generate a random hex ID of specified length
 */
function generateId(length: number): string {
  const bytes = new Uint8Array(length / 2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a 32-character trace ID (128-bit)
 */
export function generateTraceId(): string {
  return generateId(32)
}

/**
 * Generate a 16-character span ID (64-bit)
 */
export function generateSpanId(): string {
  return generateId(16)
}

/**
 * Span status codes
 */
export enum SpanStatusCode {
  /** The operation completed successfully */
  OK = 'OK',
  /** The operation contained an error */
  ERROR = 'ERROR',
  /** The span status is not set */
  UNSET = 'UNSET',
}

/**
 * Span kind - describes the relationship between the span and its parent
 */
export enum SpanKind {
  /** Internal operation within an application */
  INTERNAL = 'INTERNAL',
  /** Server-side handling of a synchronous request */
  SERVER = 'SERVER',
  /** Client-side of a synchronous request */
  CLIENT = 'CLIENT',
  /** Initiator of an asynchronous request */
  PRODUCER = 'PRODUCER',
  /** Handler of an asynchronous request */
  CONSUMER = 'CONSUMER',
}

/**
 * Span status
 */
export interface SpanStatus {
  code: SpanStatusCode
  message?: string
}

/**
 * Span event - a time-stamped annotation
 */
export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, unknown>
}

/**
 * Span link - a reference to a related span
 */
export interface SpanLink {
  traceId: string
  spanId: string
  attributes?: Record<string, unknown>
}

/**
 * Span context - the identifying information for a span
 */
export interface SpanContext {
  traceId: string
  spanId: string
  traceFlags: number
  traceState?: string
}

/**
 * Span data for export/serialization
 */
export interface SpanData {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: SpanKind
  startTime: number
  endTime?: number
  duration?: number
  status: SpanStatus
  attributes: Record<string, unknown>
  events: SpanEvent[]
  links: SpanLink[]
}

/**
 * Span interface
 */
export interface Span {
  /** Get the span context */
  context(): SpanContext
  /** Get the span name */
  getName(): string
  /** Set the span name */
  setName(name: string): Span
  /** Set a single attribute */
  setAttribute(key: string, value: unknown): Span
  /** Set multiple attributes */
  setAttributes(attributes: Record<string, unknown>): Span
  /** Add an event to the span */
  addEvent(name: string, attributes?: Record<string, unknown>): Span
  /** Set the span status */
  setStatus(status: SpanStatus): Span
  /** Record an exception */
  recordException(exception: Error, attributes?: Record<string, unknown>): Span
  /** End the span (records end time) */
  end(): void
  /** Check if the span has ended */
  isEnded(): boolean
  /** Get span data for export */
  toJSON(): SpanData
  /** Check if span is recording */
  isRecording(): boolean
  /** Add a link to another span */
  addLink(link: SpanLink): Span
}

/**
 * Span options
 */
export interface SpanOptions {
  kind?: SpanKind
  attributes?: Record<string, unknown>
  links?: SpanLink[]
  startTime?: number
  parent?: SpanContext | null
}

/**
 * Create a new span
 */
function createSpan(
  name: string,
  traceId: string,
  options: SpanOptions = {}
): Span {
  const spanId = generateSpanId()
  const startTime = options.startTime ?? Date.now()
  const kind = options.kind ?? SpanKind.INTERNAL
  const attributes: Record<string, unknown> = { ...(options.attributes || {}) }
  const events: SpanEvent[] = []
  const links: SpanLink[] = [...(options.links || [])]
  let status: SpanStatus = { code: SpanStatusCode.UNSET }
  let endTime: number | undefined
  let spanName = name
  const parentSpanId = options.parent?.spanId

  const span: Span = {
    context(): SpanContext {
      return {
        traceId,
        spanId,
        traceFlags: 1, // Sampled
      }
    },

    getName(): string {
      return spanName
    },

    setName(newName: string): Span {
      spanName = newName
      return span
    },

    setAttribute(key: string, value: unknown): Span {
      attributes[key] = value
      return span
    },

    setAttributes(attrs: Record<string, unknown>): Span {
      Object.assign(attributes, attrs)
      return span
    },

    addEvent(eventName: string, eventAttributes?: Record<string, unknown>): Span {
      events.push({
        name: eventName,
        timestamp: Date.now(),
        ...(eventAttributes && { attributes: eventAttributes }),
      })
      return span
    },

    setStatus(newStatus: SpanStatus): Span {
      status = newStatus
      return span
    },

    recordException(exception: Error, exceptionAttributes?: Record<string, unknown>): Span {
      events.push({
        name: 'exception',
        timestamp: Date.now(),
        attributes: {
          'exception.type': exception.name,
          'exception.message': exception.message,
          'exception.stacktrace': exception.stack,
          ...exceptionAttributes,
        },
      })
      status = { code: SpanStatusCode.ERROR, message: exception.message }
      return span
    },

    end(): void {
      if (endTime === undefined) {
        endTime = Date.now()
      }
    },

    isEnded(): boolean {
      return endTime !== undefined
    },

    isRecording(): boolean {
      return !span.isEnded()
    },

    addLink(link: SpanLink): Span {
      links.push(link)
      return span
    },

    toJSON(): SpanData {
      return {
        traceId,
        spanId,
        ...(parentSpanId !== undefined && { parentSpanId }),
        name: spanName,
        kind,
        startTime,
        ...(endTime !== undefined && { endTime }),
        ...(endTime !== undefined && { duration: endTime - startTime }),
        status,
        attributes,
        events,
        links,
      }
    },
  }

  return span
}

/**
 * Tracer interface for creating and managing spans
 */
export interface Tracer {
  /** Start a new span */
  startSpan(name: string, options?: SpanOptions): Span
  /** Start a span as a child of the current active span */
  startActiveSpan<T>(name: string, fn: (span: Span) => T): T
  /** Start a span with options as a child of the current active span */
  startActiveSpanWithOptions<T>(name: string, options: SpanOptions, fn: (span: Span) => T): T
  /** Get the current active span */
  getActiveSpan(): Span | undefined
  /** Set the active span */
  setActiveSpan(span: Span | undefined): void
  /** Get the tracer name */
  getName(): string
  /** Get trace context for propagation */
  getTraceContext(): SpanContext | undefined
  /** Create a child tracer with a new trace */
  withTrace(traceId?: string): Tracer
}

/**
 * Tracer configuration
 */
export interface TracerConfig {
  name: string
  version?: string
}

/**
 * Create a tracer instance
 */
export function createTracer(config: TracerConfig): Tracer {
  let activeSpan: Span | undefined
  let currentTraceId: string | undefined

  const tracer: Tracer = {
    startSpan(name: string, options: SpanOptions = {}): Span {
      const traceId = options.parent?.traceId ?? currentTraceId ?? generateTraceId()
      const parentContext = options.parent ?? (activeSpan ? activeSpan.context() : undefined)

      return createSpan(name, traceId, {
        ...options,
        parent: parentContext ?? null,
      })
    },

    startActiveSpan<T>(name: string, fn: (span: Span) => T): T {
      return tracer.startActiveSpanWithOptions(name, {}, fn)
    },

    startActiveSpanWithOptions<T>(name: string, options: SpanOptions, fn: (span: Span) => T): T {
      const parentSpan = activeSpan
      const parent = options.parent ?? (parentSpan ? parentSpan.context() : null)
      const span = tracer.startSpan(name, {
        ...options,
        ...(parent && { parent }),
      })

      activeSpan = span

      try {
        const result = fn(span)
        // Handle promises
        if (result instanceof Promise) {
          return result
            .then((res) => {
              if (span.isRecording()) {
                span.setStatus({ code: SpanStatusCode.OK })
                span.end()
              }
              return res
            })
            .catch((error) => {
              if (span.isRecording()) {
                span.recordException(error instanceof Error ? error : new Error(String(error)))
                span.end()
              }
              throw error
            })
            .finally(() => {
              activeSpan = parentSpan
            }) as T
        }
        // Synchronous case
        if (span.isRecording()) {
          span.setStatus({ code: SpanStatusCode.OK })
          span.end()
        }
        activeSpan = parentSpan
        return result
      } catch (error) {
        if (span.isRecording()) {
          span.recordException(error instanceof Error ? error : new Error(String(error)))
          span.end()
        }
        activeSpan = parentSpan
        throw error
      }
    },

    getActiveSpan(): Span | undefined {
      return activeSpan
    },

    setActiveSpan(span: Span | undefined): void {
      activeSpan = span
    },

    getName(): string {
      return config.name
    },

    getTraceContext(): SpanContext | undefined {
      return activeSpan?.context()
    },

    withTrace(traceId?: string): Tracer {
      currentTraceId = traceId ?? generateTraceId()
      return tracer
    },
  }

  return tracer
}

/**
 * Global tracer instance
 */
let globalTracer: Tracer | undefined

/**
 * Get or create the global tracer
 */
export function getTracer(name = 'dotdo'): Tracer {
  if (!globalTracer) {
    globalTracer = createTracer({ name })
  }
  return globalTracer
}

/**
 * Set the global tracer
 */
export function setGlobalTracer(tracer: Tracer): void {
  globalTracer = tracer
}

/**
 * W3C Trace Context header names
 */
export const TRACEPARENT_HEADER = 'traceparent'
export const TRACESTATE_HEADER = 'tracestate'

/**
 * Parse W3C traceparent header
 * Format: version-traceId-spanId-traceFlags
 * Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
 */
export function parseTraceparent(header: string): SpanContext | null {
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(header)
  if (!match) return null

  const [, traceId, spanId, flags] = match
  return {
    traceId: traceId!,
    spanId: spanId!,
    traceFlags: parseInt(flags!, 16),
  }
}

/**
 * Format span context as W3C traceparent header
 */
export function formatTraceparent(context: SpanContext): string {
  const flags = context.traceFlags.toString(16).padStart(2, '0')
  return `00-${context.traceId}-${context.spanId}-${flags}`
}

/**
 * Extract trace context from HTTP headers
 */
export function extractTraceContext(headers: Headers | Record<string, string>): SpanContext | null {
  const traceparent = headers instanceof Headers
    ? headers.get(TRACEPARENT_HEADER)
    : headers[TRACEPARENT_HEADER]

  if (!traceparent) return null

  const context = parseTraceparent(traceparent)
  if (!context) return null

  const tracestate = headers instanceof Headers
    ? headers.get(TRACESTATE_HEADER)
    : headers[TRACESTATE_HEADER]

  if (tracestate) {
    context.traceState = tracestate
  }

  return context
}

/**
 * Inject trace context into HTTP headers
 */
export function injectTraceContext(headers: Headers, context: SpanContext): void {
  headers.set(TRACEPARENT_HEADER, formatTraceparent(context))
  if (context.traceState) {
    headers.set(TRACESTATE_HEADER, context.traceState)
  }
}

/**
 * Span exporter interface
 */
export interface SpanExporter {
  export(spans: SpanData[]): Promise<void>
  shutdown(): Promise<void>
}

/**
 * Console span exporter for development
 */
export function createConsoleExporter(): SpanExporter {
  const logger = createStructuredLogger({ service: 'trace-exporter' })

  return {
    async export(spans: SpanData[]): Promise<void> {
      for (const span of spans) {
        const logContext: LogContext = {
          traceId: span.traceId,
          spanId: span.spanId,
        }
        const childLogger = logger.child(logContext)

        childLogger.info(`Span: ${span.name}`, {
          kind: span.kind,
          duration: span.duration,
          status: span.status,
          attributes: span.attributes,
          events: span.events.length > 0 ? span.events : undefined,
        })
      }
    },

    async shutdown(): Promise<void> {
      // No cleanup needed for console exporter
    },
  }
}

/**
 * Batch span processor for collecting and exporting spans
 */
export interface SpanProcessor {
  onStart(span: Span): void
  onEnd(span: Span): void
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

/**
 * Create a simple batch span processor
 */
export function createBatchSpanProcessor(
  exporter: SpanExporter,
  options: {
    maxQueueSize?: number
    scheduledDelayMs?: number
    maxExportBatchSize?: number
  } = {}
): SpanProcessor {
  const {
    maxQueueSize = 2048,
    scheduledDelayMs = 5000,
    maxExportBatchSize = 512,
  } = options

  const queue: SpanData[] = []
  let flushTimer: ReturnType<typeof setTimeout> | undefined

  async function flush(): Promise<void> {
    if (queue.length === 0) return

    const batch = queue.splice(0, maxExportBatchSize)
    try {
      await exporter.export(batch)
    } catch (error) {
      console.error('Failed to export spans:', error)
    }
  }

  function scheduleFlush(): void {
    if (!flushTimer) {
      flushTimer = setTimeout(async () => {
        flushTimer = undefined
        await flush()
        if (queue.length > 0) {
          scheduleFlush()
        }
      }, scheduledDelayMs)
    }
  }

  return {
    onStart(_span: Span): void {
      // No-op for simple processor
    },

    onEnd(span: Span): void {
      if (queue.length >= maxQueueSize) {
        // Drop oldest span if queue is full
        queue.shift()
      }
      queue.push(span.toJSON())
      scheduleFlush()
    },

    async forceFlush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      while (queue.length > 0) {
        await flush()
      }
    },

    async shutdown(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      await flush()
      await exporter.shutdown()
    },
  }
}

/**
 * Instrumented function wrapper for automatic span creation
 */
export function instrument<T extends (...args: unknown[]) => unknown>(
  name: string,
  fn: T,
  options: { tracer?: Tracer; kind?: SpanKind; attributes?: Record<string, unknown> } = {}
): T {
  const tracer = options.tracer ?? getTracer()

  return ((...args: Parameters<T>) => {
    return tracer.startActiveSpanWithOptions(
      name,
      {
        ...(options.kind !== undefined && { kind: options.kind }),
        ...(options.attributes !== undefined && { attributes: options.attributes }),
      },
      (span) => {
        return fn(...args)
      }
    )
  }) as T
}
