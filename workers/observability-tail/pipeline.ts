/**
 * Tail Worker Pipeline Integration
 *
 * Provides batching, sampling, and forwarding of observability events
 * from the Tail Worker to Cloudflare Pipelines.
 *
 * Features:
 * - Time-based and size-based batching
 * - Trace ID based sampling with consistent decisions
 * - W3C Trace Context propagation
 * - Exponential backoff retry
 * - Metric aggregation
 *
 * @see https://developers.cloudflare.com/workers/observability/tail-workers/
 * @see https://developers.cloudflare.com/pipelines/
 */

import type { Pipeline } from '../../tests/mocks/pipeline'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for the TailWorkerPipeline
 */
export interface TailWorkerPipelineConfig {
  /** Maximum batch size before flush */
  batchSize: number
  /** Maximum time to wait before flushing (ms) */
  batchTimeoutMs: number
  /** Sampling rate for normal events (0.0 - 1.0) */
  samplingRate: number
  /** Sampling rate for error events (0.0 - 1.0) */
  errorSamplingRate: number
  /** Maximum number of retry attempts */
  maxRetries: number
  /** Initial delay between retries (ms) */
  retryDelayMs: number
  /** Sampling strategy */
  samplingStrategy?: 'head-based' | 'tail-based'
  /** Metric aggregation window (ms) */
  metricAggregationWindowMs?: number
}

/**
 * Trace span representing a unit of work
 */
export interface TraceSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  operationName: string
  startTime: number
  endTime: number
  duration: number
  status: 'ok' | 'error' | 'unset'
  attributes: Record<string, unknown>
  events: Array<{
    name: string
    timestamp: number
    attributes?: Record<string, unknown>
  }>
}

/**
 * Trace context for distributed tracing
 */
export interface TraceContext {
  traceId: string
  spanId: string
  parentSpanId?: string
  sampled: boolean
  traceState?: string
  baggage?: Map<string, string>
}

/**
 * Error information
 */
interface TailError {
  name: string
  message: string
  stack?: string
  cause?: TailError
}

/**
 * Tail event from a worker
 */
export interface TailEvent {
  type: 'log' | 'error' | 'unhandledrejection' | 'metric'
  timestamp: number
  scriptName: string
  message?: string[]
  level?: string
  traceContext?: TraceContext
  error?: TailError
}

/**
 * Metric event
 */
interface MetricEvent {
  type: 'counter' | 'gauge' | 'histogram'
  name: string
  value: number
  tags?: Record<string, string>
}

/**
 * Batcher configuration
 */
export interface BatcherConfig<T> {
  maxSize: number
  maxDelayMs: number
  onFlush: (batch: T[]) => Promise<void>
  onError?: (error: Error) => void
}

/**
 * Batcher interface
 */
export interface Batcher<T> {
  add(item: T): void
  flush(): Promise<void>
  getPendingCount(): number
}

// ============================================================================
// Batcher Utility
// ============================================================================

/**
 * Creates a batcher that collects items and flushes them in batches
 */
export function createBatcher<T>(config: BatcherConfig<T>): Batcher<T> {
  const pending: T[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushing = false

  const scheduleFlush = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      doFlush()
    }, config.maxDelayMs)
  }

  const doFlush = async () => {
    if (flushing || pending.length === 0) return
    flushing = true

    const batch = pending.splice(0, pending.length)
    if (timer) {
      clearTimeout(timer)
      timer = null
    }

    try {
      await config.onFlush(batch)
    } catch (error) {
      if (config.onError) {
        config.onError(error as Error)
      }
    } finally {
      flushing = false
    }
  }

  return {
    add(item: T) {
      pending.push(item)
      if (pending.length >= config.maxSize) {
        doFlush()
      } else {
        scheduleFlush()
      }
    },
    async flush() {
      await doFlush()
    },
    getPendingCount() {
      return pending.length
    },
  }
}

// ============================================================================
// TailWorkerPipeline Class
// ============================================================================

/**
 * Pipeline integration for the Tail Worker
 */
export class TailWorkerPipeline {
  private pipeline: Pipeline
  private config: TailWorkerPipelineConfig
  private pending: Array<TailEvent | TraceSpan> = []
  private receivedCount = 0
  private forwardedCount = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private isShutdownState = false
  private samplingDecisions = new Map<string, boolean>()
  private tailBasedBuffer = new Map<string, Array<TailEvent | TraceSpan>>()
  private metrics = new Map<string, { type: string; values: number[]; tags?: Record<string, string> }>()
  private metricTimer: ReturnType<typeof setTimeout> | null = null
  private memoryUsage = 0
  private flushing = false
  private pendingFlush: Promise<void> | null = null

  constructor(pipeline: Pipeline, config: TailWorkerPipelineConfig) {
    this.pipeline = pipeline
    this.config = config

    // Start metric aggregation timer if configured
    if (config.metricAggregationWindowMs) {
      this.startMetricTimer()
    }
  }

  /**
   * Receive a trace span
   */
  async receiveSpan(span: TraceSpan): Promise<void> {
    if (this.isShutdownState) {
      throw new Error('Pipeline is shutdown')
    }

    this.receivedCount++

    // Check sampling decision
    const shouldSample = this.shouldSample(span.traceId, false)
    if (!shouldSample) return

    // For tail-based sampling, buffer the span
    if (this.config.samplingStrategy === 'tail-based') {
      this.bufferForTailBasedSampling(span.traceId, span)
      return
    }

    this.addToPending(span)
    this.scheduleFlush()
    this.checkSizeFlush()
  }

  /**
   * Receive a tail event
   */
  async receiveEvent(event: TailEvent): Promise<void> {
    if (this.isShutdownState) {
      throw new Error('Pipeline is shutdown')
    }

    this.receivedCount++

    const isError = event.type === 'error' || event.type === 'unhandledrejection' || event.level === 'error'
    const traceId = event.traceContext?.traceId

    // Check sampling decision
    if (traceId) {
      const shouldSample = this.shouldSample(traceId, isError)
      if (!shouldSample) return

      // For tail-based sampling, buffer the event
      if (this.config.samplingStrategy === 'tail-based') {
        this.bufferForTailBasedSampling(traceId, event)
        return
      }
    } else {
      // No trace ID - sample based on error status
      // Error events always sampled when errorSamplingRate is 1.0
      const rate = isError ? this.config.errorSamplingRate : this.config.samplingRate
      if (rate < 1.0 && Math.random() >= rate) return
    }

    this.addToPending(event)
    this.scheduleFlush()
    this.checkSizeFlush()
  }

  /**
   * Receive a metric event
   */
  async receiveMetric(metric: MetricEvent): Promise<void> {
    if (this.isShutdownState) {
      throw new Error('Pipeline is shutdown')
    }

    const key = `${metric.name}:${JSON.stringify(metric.tags ?? {})}`
    let entry = this.metrics.get(key)

    if (!entry) {
      entry = { type: metric.type, values: [], tags: metric.tags }
      this.metrics.set(key, entry)
    }

    entry.values.push(metric.value)
  }

  /**
   * Complete a trace for tail-based sampling
   */
  async completeTrace(traceId: string): Promise<void> {
    const buffered = this.tailBasedBuffer.get(traceId)
    if (!buffered) return

    // Make sampling decision now
    const shouldSample = this.shouldSample(traceId, this.hasErrorInTrace(buffered))
    this.tailBasedBuffer.delete(traceId)

    if (shouldSample) {
      for (const item of buffered) {
        this.addToPending(item)
      }
      await this.flush()
    }
  }

  /**
   * Flush all pending events to the pipeline
   */
  async flush(): Promise<void> {
    // If already flushing, wait for it to complete then flush again if needed
    if (this.flushing && this.pendingFlush) {
      await this.pendingFlush
      // After waiting, check if there are new pending items
      if (this.pending.length > 0 && !this.flushing) {
        return this.flush()
      }
      return
    }

    // Flush metrics first (fire and forget for timer-triggered flushes)
    // Use void to suppress floating promise warning
    void this.flushMetrics()

    if (this.pending.length === 0) return

    // Cancel scheduled flush
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.flushing = true
    const batch = this.pending.splice(0, this.pending.length)
    const formattedBatch = batch.map(item => this.formatEvent(item))

    try {
      this.pendingFlush = this.sendWithRetry(formattedBatch)
      await this.pendingFlush
      this.forwardedCount += batch.length
    } finally {
      this.flushing = false
      this.pendingFlush = null
    }
  }

  /**
   * Get the number of pending events
   */
  getPendingCount(): number {
    return this.pending.length
  }

  /**
   * Get the total number of received events
   */
  getReceivedCount(): number {
    return this.receivedCount
  }

  /**
   * Shutdown the pipeline
   */
  async shutdown(): Promise<void> {
    this.isShutdownState = true

    // Flush metrics
    await this.flushMetrics()

    // Flush pending events
    await this.flush()

    // Cleanup timers
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.metricTimer) {
      clearTimeout(this.metricTimer)
      this.metricTimer = null
    }
  }

  /**
   * Check if the pipeline is shutdown
   */
  isShutdown(): boolean {
    return this.isShutdownState
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    memoryUsageBytes: number
    pendingEvents: number
    totalReceived: number
    totalForwarded: number
  } {
    return {
      memoryUsageBytes: this.memoryUsage,
      pendingEvents: this.pending.length,
      totalReceived: this.receivedCount,
      totalForwarded: this.forwardedCount,
    }
  }

  /**
   * Extract trace context from headers (W3C Trace Context)
   */
  static extractTraceContext(headers: Headers): TraceContext {
    const traceparent = headers.get('traceparent')
    const tracestate = headers.get('tracestate')
    const baggageHeader = headers.get('baggage')

    if (traceparent) {
      const parts = traceparent.split('-')
      if (parts.length >= 4) {
        const [, traceId, spanId, flags] = parts
        const sampled = (parseInt(flags, 16) & 0x01) === 1

        // Parse baggage
        let baggage: Map<string, string> | undefined
        if (baggageHeader) {
          baggage = new Map()
          for (const pair of baggageHeader.split(',')) {
            const [key, value] = pair.split('=').map(s => s.trim())
            if (key && value) {
              baggage.set(key, value)
            }
          }
        }

        return {
          traceId,
          spanId,
          sampled,
          traceState: tracestate ?? undefined,
          baggage,
        }
      }
    }

    // Generate new trace context
    return {
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId(),
      sampled: true,
    }
  }

  /**
   * Inject trace context into headers (W3C Trace Context)
   */
  static injectTraceContext(headers: Headers, context: TraceContext): void {
    const flags = context.sampled ? '01' : '00'
    const traceparent = `00-${context.traceId}-${context.spanId}-${flags}`
    headers.set('traceparent', traceparent)

    if (context.traceState) {
      headers.set('tracestate', context.traceState)
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private addToPending(item: TailEvent | TraceSpan): void {
    this.pending.push(item)
    // Rough memory estimate
    this.memoryUsage += JSON.stringify(item).length
  }

  private scheduleFlush(): void {
    if (this.timer) return
    this.timer = setTimeout(async () => {
      this.timer = null
      await this.flush()
    }, this.config.batchTimeoutMs)
  }

  private checkSizeFlush(): void {
    if (this.pending.length >= this.config.batchSize && !this.flushing) {
      this.flush()
    }
  }

  private shouldSample(traceId: string, isError: boolean): boolean {
    // For errors, if errorSamplingRate is 1.0, always sample
    if (isError && this.config.errorSamplingRate >= 1.0) {
      // Update cached decision to true (trace now has error, should be sampled)
      this.samplingDecisions.set(traceId, true)
      return true
    }

    // Check cached decision
    if (this.samplingDecisions.has(traceId)) {
      const cachedDecision = this.samplingDecisions.get(traceId)!
      // If previously sampled, continue sampling
      // If error and cached is false, re-evaluate with error rate
      if (cachedDecision || !isError) {
        return cachedDecision
      }
    }

    // Errors use error sampling rate
    const rate = isError ? this.config.errorSamplingRate : this.config.samplingRate

    // Deterministic sampling based on trace ID
    const shouldSample = this.hashTraceId(traceId) < rate
    this.samplingDecisions.set(traceId, shouldSample)

    return shouldSample
  }

  private hashTraceId(traceId: string): number {
    // djb2 hash with additional mixing for good distribution
    let hash = 5381
    for (let i = 0; i < traceId.length; i++) {
      hash = ((hash << 5) + hash) + traceId.charCodeAt(i)
    }
    // Mix the bits for better distribution
    hash = hash ^ (hash >>> 16)
    hash = Math.imul(hash, 0x85ebca6b)
    hash = hash ^ (hash >>> 13)
    hash = Math.imul(hash, 0xc2b2ae35)
    hash = hash ^ (hash >>> 16)
    // Convert to 0-1 range
    return (hash >>> 0) / 0xFFFFFFFF
  }

  private bufferForTailBasedSampling(traceId: string, item: TailEvent | TraceSpan): void {
    let buffer = this.tailBasedBuffer.get(traceId)
    if (!buffer) {
      buffer = []
      this.tailBasedBuffer.set(traceId, buffer)
    }
    buffer.push(item)
  }

  private hasErrorInTrace(items: Array<TailEvent | TraceSpan>): boolean {
    return items.some(item => {
      if ('type' in item) {
        return item.type === 'error' || item.type === 'unhandledrejection' || item.level === 'error'
      }
      return false
    })
  }

  private formatEvent(item: TailEvent | TraceSpan): any {
    const batchId = crypto.randomUUID()
    const receivedAt = Date.now()

    // Handle TraceSpan
    if ('operationName' in item) {
      return {
        ...item,
        metadata: {
          pipelineVersion: '1.0.0',
          batchId,
          receivedAt,
        },
      }
    }

    // Handle TailEvent
    const formatted: any = {
      timestamp: item.timestamp,
      script: item.scriptName,
      scriptName: item.scriptName, // Also include as scriptName for compatibility
      traceContext: item.traceContext,
      metadata: {
        pipelineVersion: '1.0.0',
        batchId,
        receivedAt,
      },
    }

    // Map type
    if (item.type === 'error' || item.type === 'unhandledrejection') {
      formatted.type = 'exception'
      formatted.level = 'error'
      formatted.message = item.error ? [item.error.message] : item.message ?? []
      formatted.stack = item.error?.stack

      if (item.type === 'unhandledrejection') {
        formatted.metadata.unhandledRejection = true
      }

      if (item.error?.cause) {
        formatted.metadata.cause = item.error.cause
      }
    } else {
      formatted.type = item.type
      formatted.level = this.mapLogLevel(item.level)
      formatted.message = this.serializeMessage(item.message ?? [])
    }

    return formatted
  }

  /**
   * Serialize message items to strings
   */
  private serializeMessage(message: any[]): string[] {
    return message.map(item => {
      if (item === null) return 'null'
      if (item === undefined) return 'undefined'
      if (typeof item === 'string') return item
      if (typeof item === 'number' || typeof item === 'boolean') return String(item)
      try {
        return JSON.stringify(item)
      } catch {
        return String(item)
      }
    })
  }

  private mapLogLevel(level?: string): string {
    if (!level) return 'info'
    if (level === 'log') return 'info'
    if (level === 'warning') return 'warn'
    return level
  }

  private async sendWithRetry(batch: any[]): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.pipeline.send(batch)
        return
      } catch (error) {
        lastError = error as Error
        if (attempt < this.config.maxRetries) {
          // Exponential backoff
          const delay = this.config.retryDelayMs * Math.pow(2, attempt)
          await this.sleep(delay)
        }
      }
    }

    if (lastError) {
      throw lastError
    }
  }

  /**
   * Sleep for a given duration - works with both real and fake timers
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, ms)
    })
  }

  private startMetricTimer(): void {
    this.metricTimer = setInterval(() => {
      this.flushMetrics()
    }, this.config.metricAggregationWindowMs)
  }

  private async flushMetrics(): Promise<void> {
    if (this.metrics.size === 0) return

    const events: any[] = []

    for (const [key, entry] of this.metrics) {
      const name = key.split(':')[0]
      let value: number
      let statistics: any

      if (entry.type === 'counter') {
        // Sum all values
        value = entry.values.reduce((a, b) => a + b, 0)
      } else if (entry.type === 'gauge') {
        // Take latest value
        value = entry.values[entry.values.length - 1]
      } else {
        // Histogram - compute statistics
        const sorted = [...entry.values].sort((a, b) => a - b)
        value = sorted[sorted.length - 1]
        statistics = {
          count: sorted.length,
          min: sorted[0],
          max: sorted[sorted.length - 1],
          avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
          p50: this.percentile(sorted, 50),
          p95: this.percentile(sorted, 95),
          p99: this.percentile(sorted, 99),
        }
      }

      events.push({
        type: 'metric',
        name,
        value,
        tags: entry.tags,
        statistics,
        timestamp: Date.now(),
      })
    }

    this.metrics.clear()

    if (events.length > 0) {
      await this.pipeline.send(events)
    }
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
  }

  private static generateTraceId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }

  private static generateSpanId(): string {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  }
}
