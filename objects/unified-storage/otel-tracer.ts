/**
 * OpenTelemetry Tracer - Distributed tracing for unified storage operations
 *
 * Provides OpenTelemetry-compatible tracing for storage operations:
 * - Span creation for read/write operations
 * - W3C traceparent format for context propagation
 * - Batch export with configurable batch size
 * - Error tracking with semantic attributes
 *
 * @module objects/unified-storage/otel-tracer
 */

import type { DomainEvent } from './cold-start-recovery'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Trace context for propagation
 */
export interface TraceContext {
  traceId: string
  spanId: string
  sampled?: boolean
}

/**
 * Span event with timestamp and attributes
 */
export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, unknown>
}

/**
 * Span exporter interface
 */
export interface SpanExporter {
  export(spans: CollectedSpan[]): Promise<void>
  shutdown(): Promise<void>
}

/**
 * Collected span data for export
 */
export interface CollectedSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 'internal' | 'client' | 'server' | 'producer' | 'consumer'
  startTimeMs: number
  endTimeMs?: number
  status: 'ok' | 'error' | 'unset'
  attributes: Record<string, string | number | boolean>
  events: SpanEvent[]
}

/**
 * Span options for manual span creation
 */
export interface SpanOptions {
  /** Parent span for hierarchy */
  parent?: Span
  /** Explicit trace context */
  context?: TraceContext | null
  /** Span kind */
  kind?: 'internal' | 'client' | 'server' | 'producer' | 'consumer'
  /** Initial attributes */
  attributes?: Record<string, string | number | boolean>
}

/**
 * Active span interface
 */
export interface Span {
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly startTimeMs: number
  endTimeMs?: number
  readonly attributes: Record<string, unknown>
  status: 'ok' | 'error' | 'unset'
  readonly events: SpanEvent[]

  /** Set a single attribute */
  setAttribute(key: string, value: string | number | boolean): void

  /** Set span status */
  setStatus(status: 'ok' | 'error' | 'unset'): void

  /** Add an event to the span */
  addEvent(name: string, attributes?: Record<string, unknown>): void

  /** End the span */
  end(): void
}

/**
 * Tracer configuration
 */
export interface TracerConfig {
  serviceName: string
  namespace?: string
  exporter?: SpanExporter
  samplingRate?: number
  defaultAttributes?: Record<string, string>
  batchSize?: number
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a random hex string of specified length
 */
function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a trace ID (32 hex chars)
 */
function generateTraceId(): string {
  return randomHex(32)
}

/**
 * Generate a span ID (16 hex chars)
 */
function generateSpanId(): string {
  return randomHex(16)
}

// ============================================================================
// SPAN IMPLEMENTATION
// ============================================================================

/**
 * Active span implementation
 */
class SpanImpl implements Span {
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly startTimeMs: number
  endTimeMs?: number
  status: 'ok' | 'error' | 'unset' = 'unset'
  readonly events: SpanEvent[] = []
  readonly attributes: Record<string, unknown> = {}
  readonly kind: 'internal' | 'client' | 'server' | 'producer' | 'consumer'

  private ended = false
  private readonly onEnd: (span: SpanImpl) => void

  constructor(
    name: string,
    options: {
      traceId: string
      spanId: string
      parentSpanId?: string
      startTimeMs: number
      kind?: 'internal' | 'client' | 'server' | 'producer' | 'consumer'
      attributes?: Record<string, string | number | boolean>
      onEnd: (span: SpanImpl) => void
    }
  ) {
    this.name = name
    this.traceId = options.traceId
    this.spanId = options.spanId
    this.parentSpanId = options.parentSpanId
    this.startTimeMs = options.startTimeMs
    this.kind = options.kind ?? 'internal'
    this.onEnd = options.onEnd

    // Copy initial attributes
    if (options.attributes) {
      Object.assign(this.attributes, options.attributes)
    }
  }

  setAttribute(key: string, value: string | number | boolean): void {
    if (!this.ended) {
      this.attributes[key] = value
    }
  }

  setStatus(status: 'ok' | 'error' | 'unset'): void {
    if (!this.ended) {
      this.status = status
    }
  }

  addEvent(name: string, attributes?: Record<string, unknown>): void {
    if (!this.ended) {
      this.events.push({
        name,
        timestamp: Date.now(),
        attributes,
      })
    }
  }

  end(): void {
    if (this.ended) return
    this.ended = true
    this.endTimeMs = Date.now()

    // If no explicit status was set, mark as ok
    if (this.status === 'unset') {
      this.status = 'ok'
    }

    this.onEnd(this)
  }

  /**
   * Convert to collected span format for export
   */
  toCollectedSpan(): CollectedSpan {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startTimeMs: this.startTimeMs,
      endTimeMs: this.endTimeMs,
      status: this.status,
      attributes: this.attributes as Record<string, string | number | boolean>,
      events: this.events,
    }
  }
}

// ============================================================================
// OTEL TRACER CLASS
// ============================================================================

/**
 * OpenTelemetry Tracer for unified storage operations
 */
export class OtelTracer {
  readonly serviceName: string
  readonly namespace: string
  readonly samplingRate: number

  private readonly exporter?: SpanExporter
  private readonly defaultAttributes: Record<string, string>
  private readonly batchSize: number
  private pendingSpans: SpanImpl[] = []

  constructor(config: TracerConfig) {
    this.serviceName = config.serviceName
    this.namespace = config.namespace ?? 'default'
    this.exporter = config.exporter
    this.samplingRate = config.samplingRate ?? 1.0
    this.defaultAttributes = config.defaultAttributes ?? {}
    this.batchSize = config.batchSize ?? 100
  }

  /**
   * Start a new span
   */
  startSpan(name: string, options?: SpanOptions): Span {
    let traceId: string
    let parentSpanId: string | undefined

    if (options?.context) {
      // Use provided trace context
      traceId = options.context.traceId
      parentSpanId = options.context.spanId
    } else if (options?.parent) {
      // Inherit from parent span
      traceId = options.parent.traceId
      parentSpanId = options.parent.spanId
    } else {
      // Generate new trace
      traceId = generateTraceId()
      parentSpanId = undefined
    }

    const span = new SpanImpl(name, {
      traceId,
      spanId: generateSpanId(),
      parentSpanId,
      startTimeMs: Date.now(),
      kind: options?.kind ?? 'internal',
      attributes: {
        ...this.defaultAttributes,
        namespace: this.namespace,
        ...options?.attributes,
      },
      onEnd: (s) => this.onSpanEnd(s),
    })

    return span
  }

  /**
   * Wrap an async function with a span
   * Immediately flushes the span after completion for consistent export behavior
   */
  async traced<T>(
    operation: string,
    fn: (span: Span) => Promise<T>,
    options?: SpanOptions
  ): Promise<T> {
    const span = this.startSpan(operation, options)

    try {
      const result = await fn(span)
      span.setStatus('ok')
      return result
    } catch (error) {
      span.setStatus('error')
      if (error instanceof Error) {
        span.addEvent('exception', {
          'exception.type': error.name,
          'exception.message': error.message,
        })
      }
      throw error
    } finally {
      span.end()
      // Immediately export the span for consistent behavior
      // This ensures spans are available for inspection between operations
      await this.flush()
    }
  }

  /**
   * Extract trace context from W3C traceparent header
   */
  extractContext(headers: { traceparent?: string }): TraceContext | null {
    const traceparent = headers.traceparent
    if (!traceparent) return null

    // W3C traceparent format: version-traceId-spanId-flags
    // e.g., 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
    const parts = traceparent.split('-')
    if (parts.length !== 4) return null

    const [, traceId, spanId, flags] = parts

    // Validate lengths
    if (traceId.length !== 32 || spanId.length !== 16) return null

    return {
      traceId,
      spanId,
      sampled: flags === '01',
    }
  }

  /**
   * Inject trace context as W3C traceparent header
   */
  injectContext(span: Span): { traceparent: string } {
    // W3C traceparent format: version-traceId-spanId-flags
    const flags = '01' // sampled
    return {
      traceparent: `00-${span.traceId}-${span.spanId}-${flags}`,
    }
  }

  /**
   * Enrich a Pipeline event with trace context
   */
  enrichPipelineEvent<T extends Record<string, unknown>>(
    event: T,
    span: Span
  ): T & { traceId: string; spanId: string } {
    return {
      ...event,
      traceId: span.traceId,
      spanId: span.spanId,
    }
  }

  /**
   * Extract trace context from a Pipeline event
   */
  extractFromPipelineEvent(
    event: DomainEvent & { traceId?: string; spanId?: string }
  ): TraceContext | null {
    if (!event.traceId || !event.spanId) return null

    return {
      traceId: event.traceId,
      spanId: event.spanId,
    }
  }

  /**
   * Flush all pending spans to the exporter
   */
  async flush(): Promise<void> {
    if (this.pendingSpans.length === 0 || !this.exporter) return

    const spans = this.pendingSpans.map((s) => s.toCollectedSpan())
    this.pendingSpans = []

    await this.exporter.export(spans)
  }

  /**
   * Shutdown the tracer and flush remaining spans
   */
  async shutdown(): Promise<void> {
    await this.flush()
    if (this.exporter) {
      await this.exporter.shutdown()
    }
  }

  /**
   * Handle span end - buffer for batch export
   */
  private onSpanEnd(span: SpanImpl): void {
    this.pendingSpans.push(span)

    // Auto-export when batch size reached
    if (this.pendingSpans.length >= this.batchSize && this.exporter) {
      const spans = this.pendingSpans.map((s) => s.toCollectedSpan())
      this.pendingSpans = []

      // Fire and forget the export
      this.exporter.export(spans).catch(() => {
        // Best effort - don't throw
      })
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an OtelTracer configured for unified storage
 */
export function createUnifiedStorageTracer(config: TracerConfig): OtelTracer {
  return new OtelTracer(config)
}
