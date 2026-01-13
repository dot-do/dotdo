/**
 * @dotdo/datadog - APM Tracing Module
 *
 * Datadog-compatible distributed tracing API.
 *
 * @module @dotdo/datadog/tracing
 */

import type {
  Span,
  SpanContext,
  SpanOptions,
  SpanType,
  SpanStatus,
  Tracer,
  TracerOptions,
  TracerScope,
  DatadogConfig,
  DatadogResponse,
  SerializedSpan,
} from './types.js'

// =============================================================================
// Constants
// =============================================================================

const PROPAGATION_STYLE_DATADOG = 'datadog'
const PROPAGATION_STYLE_B3 = 'b3'

// Header names
const DD_TRACE_ID = 'x-datadog-trace-id'
const DD_PARENT_ID = 'x-datadog-parent-id'
const DD_SAMPLING_PRIORITY = 'x-datadog-sampling-priority'
const DD_ORIGIN = 'x-datadog-origin'

const B3_TRACE_ID = 'x-b3-traceid'
const B3_SPAN_ID = 'x-b3-spanid'
const B3_PARENT_ID = 'x-b3-parentspanid'
const B3_SAMPLED = 'x-b3-sampled'

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a random 64-bit hex ID.
 */
function generateId64(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a random 128-bit hex ID.
 */
function generateId128(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// =============================================================================
// Span Implementation
// =============================================================================

/**
 * Internal span implementation.
 */
class SpanImpl implements Span {
  private readonly _traceId: string
  private readonly _spanId: string
  private readonly _parentId?: string
  private readonly _name: string
  private readonly _service: string
  private readonly _resource: string
  private readonly _type: SpanType
  private readonly _startTime: number
  private _endTime?: number
  private _error: boolean = false
  private _tags: Record<string, unknown> = {}
  private _metrics: Record<string, number> = {}
  private _logs: Array<{ timestamp: number; data: Record<string, unknown> }> = []
  private _finished = false
  private readonly tracer: TracerImpl

  constructor(
    tracer: TracerImpl,
    name: string,
    options: SpanOptions & { traceId?: string; parentId?: string }
  ) {
    this.tracer = tracer
    this._traceId = options.traceId ?? generateId64()
    this._spanId = generateId64()
    this._parentId = options.parentId
    this._name = name
    this._service = options.service ?? tracer.service
    this._resource = options.resource ?? name
    this._type = options.type ?? 'custom'
    this._startTime = options.startTime ?? performance.now()
    this._error = options.error ?? false

    if (options.tags) {
      this._tags = { ...options.tags }
    }
  }

  context(): SpanContext {
    return {
      traceId: this._traceId,
      spanId: this._spanId,
      parentId: this._parentId,
      samplingPriority: 1,
    }
  }

  setTag(key: string, value: unknown): Span {
    this._tags[key] = value
    return this
  }

  addTags(tags: Record<string, unknown>): Span {
    Object.assign(this._tags, tags)
    return this
  }

  setOperationName(name: string): Span {
    ;(this as any)._name = name
    return this
  }

  log(data: Record<string, unknown>): Span {
    this._logs.push({
      timestamp: Date.now(),
      data,
    })
    return this
  }

  finish(endTime?: number): void {
    if (this._finished) return

    this._finished = true
    this._endTime = endTime ?? performance.now()
    this.tracer._onSpanFinish(this)
  }

  traceId(): string {
    return this._traceId
  }

  spanId(): string {
    return this._spanId
  }

  service(): string {
    return this._service
  }

  resource(): string {
    return this._resource
  }

  setError(error: Error | string): Span {
    this._error = true
    if (error instanceof Error) {
      this._tags['error.type'] = error.name
      this._tags['error.msg'] = error.message
      this._tags['error.stack'] = error.stack
    } else {
      this._tags['error.msg'] = error
    }
    return this
  }

  duration(): number | undefined {
    if (!this._endTime) return undefined
    return this._endTime - this._startTime
  }

  isFinished(): boolean {
    return this._finished
  }

  /**
   * Set a metric on the span.
   */
  setMetric(key: string, value: number): Span {
    this._metrics[key] = value
    return this
  }

  /**
   * Serialize the span for transport.
   */
  serialize(): SerializedSpan {
    const meta: Record<string, string> = {}
    for (const [key, value] of Object.entries(this._tags)) {
      meta[key] = String(value)
    }

    return {
      trace_id: this._traceId,
      span_id: this._spanId,
      parent_id: this._parentId,
      name: this._name,
      service: this._service,
      resource: this._resource,
      type: this._type,
      start: Math.floor(this._startTime * 1e6), // Convert to nanoseconds
      duration: Math.floor((this.duration() ?? 0) * 1e6),
      error: this._error ? 1 : 0,
      meta,
      metrics: this._metrics,
    }
  }
}

// =============================================================================
// Tracer Scope Implementation
// =============================================================================

/**
 * Scope implementation for managing active spans.
 */
class ScopeImpl implements TracerScope {
  private readonly spanStack: Span[] = []

  active(): Span | null {
    return this.spanStack[this.spanStack.length - 1] ?? null
  }

  activate<T>(span: Span, fn: () => T): T {
    this.spanStack.push(span)
    try {
      return fn()
    } finally {
      this.spanStack.pop()
    }
  }

  bind<T extends (...args: any[]) => any>(fn: T): T {
    const activeSpan = this.active()
    return ((...args: any[]) => {
      if (activeSpan) {
        return this.activate(activeSpan, () => fn(...args))
      }
      return fn(...args)
    }) as T
  }

  /**
   * Push a span onto the stack (internal use).
   */
  _push(span: Span): void {
    this.spanStack.push(span)
  }

  /**
   * Pop a span from the stack (internal use).
   */
  _pop(): Span | undefined {
    return this.spanStack.pop()
  }
}

// =============================================================================
// Tracer Implementation
// =============================================================================

/**
 * Datadog-compatible tracer implementation.
 */
class TracerImpl implements Tracer {
  readonly service: string
  private readonly config: Required<Pick<TracerOptions, 'service' | 'env' | 'sampleRate'>> & TracerOptions
  private readonly _scope: ScopeImpl
  private readonly buffer: SerializedSpan[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private enabled = true

  constructor(options: TracerOptions = {}) {
    this.config = {
      service: options.service ?? 'unknown',
      env: options.env ?? 'development',
      sampleRate: options.sampleRate ?? 1.0,
      ...options,
    }
    this.service = this.config.service
    this._scope = new ScopeImpl()
  }

  startSpan(name: string, options: Partial<SpanOptions> = {}): Span {
    // Inherit from parent if not specified
    let traceId: string | undefined
    let parentId: string | undefined

    if (options.childOf) {
      const parentContext = 'context' in options.childOf
        ? (options.childOf as Span).context()
        : options.childOf as SpanContext
      traceId = parentContext.traceId
      parentId = parentContext.spanId
    } else {
      // Check for active span
      const activeSpan = this._scope.active()
      if (activeSpan) {
        const ctx = activeSpan.context()
        traceId = ctx.traceId
        parentId = ctx.spanId
      }
    }

    const span = new SpanImpl(this, name, {
      ...options,
      name,
      service: options.service ?? this.service,
      traceId,
      parentId,
    })

    // Auto-activate span
    this._scope._push(span)

    return span
  }

  inject(context: SpanContext, format: string, carrier: Record<string, string>): void {
    if (format === PROPAGATION_STYLE_DATADOG || format === 'text_map') {
      carrier[DD_TRACE_ID] = context.traceId
      carrier[DD_PARENT_ID] = context.spanId
      if (context.samplingPriority !== undefined) {
        carrier[DD_SAMPLING_PRIORITY] = String(context.samplingPriority)
      }
      if (context.origin) {
        carrier[DD_ORIGIN] = context.origin
      }
    } else if (format === PROPAGATION_STYLE_B3) {
      carrier[B3_TRACE_ID] = context.traceId
      carrier[B3_SPAN_ID] = context.spanId
      if (context.parentId) {
        carrier[B3_PARENT_ID] = context.parentId
      }
      carrier[B3_SAMPLED] = context.samplingPriority ? '1' : '0'
    }
  }

  extract(format: string, carrier: Record<string, string>): SpanContext | null {
    if (format === PROPAGATION_STYLE_DATADOG || format === 'text_map') {
      const traceId = carrier[DD_TRACE_ID]
      const spanId = carrier[DD_PARENT_ID]

      if (!traceId || !spanId) {
        return null
      }

      return {
        traceId,
        spanId,
        samplingPriority: carrier[DD_SAMPLING_PRIORITY]
          ? parseInt(carrier[DD_SAMPLING_PRIORITY], 10)
          : undefined,
        origin: carrier[DD_ORIGIN],
      }
    } else if (format === PROPAGATION_STYLE_B3) {
      const traceId = carrier[B3_TRACE_ID]
      const spanId = carrier[B3_SPAN_ID]

      if (!traceId || !spanId) {
        return null
      }

      return {
        traceId,
        spanId,
        parentId: carrier[B3_PARENT_ID],
        samplingPriority: carrier[B3_SAMPLED] === '1' ? 1 : 0,
      }
    }

    return null
  }

  activeSpan(): Span | null {
    return this._scope.active()
  }

  wrap<T extends (...args: any[]) => any>(
    name: string,
    fn: T,
    options?: Partial<SpanOptions>
  ): T {
    const tracer = this
    return function (this: any, ...args: any[]) {
      const span = tracer.startSpan(name, options)
      try {
        const result = fn.apply(this, args)
        if (result instanceof Promise) {
          return result
            .then((value) => {
              span.finish()
              return value
            })
            .catch((error) => {
              span.setError(error)
              span.finish()
              throw error
            }) as any
        }
        span.finish()
        return result
      } catch (error) {
        span.setError(error as Error)
        span.finish()
        throw error
      }
    } as T
  }

  async trace<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: Partial<SpanOptions>
  ): Promise<T> {
    const span = this.startSpan(name, options)
    try {
      const result = await fn(span)
      span.finish()
      return result
    } catch (error) {
      span.setError(error as Error)
      span.finish()
      throw error
    }
  }

  scope(): TracerScope {
    return this._scope
  }

  /**
   * Internal callback when span finishes.
   */
  _onSpanFinish(span: SpanImpl): void {
    if (!this.enabled) return

    // Pop from scope if it's the active span
    if (this._scope.active() === span) {
      this._scope._pop()
    }

    // Apply sampling
    if (Math.random() >= this.config.sampleRate) {
      return
    }

    // Add to buffer
    this.buffer.push(span.serialize())
  }

  /**
   * Get the span buffer.
   */
  getBuffer(): SerializedSpan[] {
    return [...this.buffer]
  }

  /**
   * Clear the span buffer.
   */
  clearBuffer(): void {
    this.buffer.length = 0
  }

  /**
   * Flush spans to transport.
   */
  async flush(): Promise<DatadogResponse> {
    if (this.buffer.length === 0) {
      return { status: 'ok', data: { span_count: 0 } }
    }

    const spans = [...this.buffer]
    this.buffer.length = 0

    return {
      status: 'ok',
      data: { span_count: spans.length },
    }
  }

  /**
   * Close the tracer.
   */
  async close(): Promise<void> {
    this.enabled = false
    this.stopAutoFlush()
    await this.flush()
  }

  /**
   * Enable the tracer.
   */
  enable(): void {
    this.enabled = true
  }

  /**
   * Disable the tracer.
   */
  disable(): void {
    this.enabled = false
  }

  /**
   * Check if tracer is enabled.
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Get tracer configuration.
   */
  getConfig(): TracerOptions {
    return { ...this.config }
  }

  /**
   * Start auto-flush timer.
   */
  startAutoFlush(intervalMs: number = 5000): void {
    if (this.flushTimer) return

    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Silently ignore flush errors
      })
    }, intervalMs)
  }

  /**
   * Stop auto-flush timer.
   */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new tracer.
 */
export function createTracer(options?: TracerOptions): TracerImpl {
  return new TracerImpl(options)
}

// =============================================================================
// Default Tracer
// =============================================================================

let defaultTracer: TracerImpl | null = null

/**
 * Initialize the global tracer.
 */
export function init(options?: TracerOptions): TracerImpl {
  defaultTracer = new TracerImpl(options)
  return defaultTracer
}

/**
 * Get the global tracer.
 */
export function tracer(): TracerImpl {
  if (!defaultTracer) {
    defaultTracer = new TracerImpl()
  }
  return defaultTracer
}

/**
 * Clear the global tracer.
 */
export function _clear(): void {
  defaultTracer = null
}

// Convenience exports
export { SpanImpl as Span }
export { TracerImpl as Tracer }
export { ScopeImpl as Scope }
