/**
 * @dotdo/sentry - Performance Tracing
 *
 * Sentry-compatible transaction and span APIs for performance monitoring.
 *
 * @module @dotdo/sentry/transactions
 */

import type { SentryEvent, Tags, SeverityLevel } from './types.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Span status values matching Sentry's OpenTelemetry-compatible statuses.
 */
export type SpanStatus =
  | 'ok'
  | 'cancelled'
  | 'unknown'
  | 'invalid_argument'
  | 'deadline_exceeded'
  | 'not_found'
  | 'already_exists'
  | 'permission_denied'
  | 'resource_exhausted'
  | 'failed_precondition'
  | 'aborted'
  | 'out_of_range'
  | 'unimplemented'
  | 'internal_error'
  | 'unavailable'
  | 'data_loss'
  | 'unauthenticated'

/**
 * Measurement with value and unit.
 */
export interface Measurement {
  value: number
  unit: 'millisecond' | 'second' | 'byte' | 'kilobyte' | 'megabyte' | 'none' | 'percent'
}

/**
 * Context for starting a span.
 */
export interface SpanContext {
  /** Operation type (e.g., 'http.server', 'db.query') */
  op?: string
  /** Human-readable description */
  description?: string
  /** Custom data */
  data?: Record<string, unknown>
  /** Tags for filtering */
  tags?: Tags
  /** Start timestamp (defaults to now) */
  startTimestamp?: number
}

/**
 * Context for starting a transaction.
 */
export interface TransactionContext extends SpanContext {
  /** Transaction name (e.g., 'GET /api/users') */
  name: string
  /** Custom trace ID */
  traceId?: string
  /** Parent span ID for distributed tracing */
  parentSpanId?: string
  /** Whether transaction should be sampled */
  sampled?: boolean
}

/**
 * Options for continuing a trace from incoming headers.
 */
export interface ContinueTraceOptions {
  /** sentry-trace header value */
  sentryTrace?: string
  /** baggage header value */
  baggage?: string
}

/**
 * Span interface for performance tracking.
 */
export interface Span {
  /** Span ID */
  readonly spanId: string
  /** Trace ID (shared across transaction) */
  readonly traceId: string
  /** Parent span ID */
  readonly parentSpanId?: string
  /** Operation type */
  readonly op?: string
  /** Description */
  readonly description?: string
  /** Start timestamp */
  readonly startTimestamp: number
  /** End timestamp (set on finish) */
  endTimestamp?: number
  /** Current status */
  status?: SpanStatus
  /** Custom data */
  data?: Record<string, unknown>
  /** Tags */
  tags?: Tags

  /** Start a child span */
  startChild(context: SpanContext): Span
  /** Set span status */
  setStatus(status: SpanStatus): void
  /** Set HTTP status and derive span status */
  setHttpStatus(httpStatus: number): void
  /** Set data key */
  setData(key: string, value: unknown): void
  /** Set tag */
  setTag(key: string, value: string): void
  /** Finish the span */
  finish(endTimestamp?: number): void
  /** Convert to traceparent header */
  toTraceparent(): string
  /** Check if span is finished */
  isFinished(): boolean
}

/**
 * Transaction interface extending Span.
 */
export interface Transaction extends Span {
  /** Transaction name */
  readonly name: string
  /** Measurements */
  measurements?: Record<string, Measurement>

  /** Get all child spans */
  getSpans(): Span[]
  /** Set a measurement */
  setMeasurement(name: string, value: number, unit: Measurement['unit']): void
  /** Convert to baggage header */
  toBaggage(): string
  /** Get the transaction event */
  toEvent(): SentryEvent
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Generate a random 16 character hex string (span ID).
 */
function generateSpanId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a random 32 character hex string (trace ID).
 */
function generateTraceId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Map HTTP status code to span status.
 */
function httpStatusToSpanStatus(httpStatus: number): SpanStatus {
  if (httpStatus >= 200 && httpStatus < 300) {
    return 'ok'
  }

  switch (httpStatus) {
    case 400:
      return 'invalid_argument'
    case 401:
      return 'unauthenticated'
    case 403:
      return 'permission_denied'
    case 404:
      return 'not_found'
    case 409:
      return 'already_exists'
    case 429:
      return 'resource_exhausted'
    case 499:
      return 'cancelled'
    case 500:
      return 'internal_error'
    case 501:
      return 'unimplemented'
    case 503:
      return 'unavailable'
    case 504:
      return 'deadline_exceeded'
    default:
      if (httpStatus >= 400 && httpStatus < 500) {
        return 'invalid_argument'
      }
      if (httpStatus >= 500) {
        return 'internal_error'
      }
      return 'unknown'
  }
}

/**
 * Parse sentry-trace header.
 * Format: {traceId}-{spanId}-{sampled}
 */
function parseSentryTrace(sentryTrace: string): {
  traceId: string
  parentSpanId: string
  sampled?: boolean
} | null {
  const match = sentryTrace.match(/^([a-f0-9]{32})-([a-f0-9]{16})(?:-([01]))?$/)
  if (!match) {
    // Try with version prefix
    const versionMatch = sentryTrace.match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-([01]{2})$/)
    if (!versionMatch) {
      return null
    }
    const sampledStr = versionMatch[3]
    return {
      traceId: versionMatch[1]!,
      parentSpanId: versionMatch[2]!,
      sampled: sampledStr === '01',
    }
  }

  return {
    traceId: match[1]!,
    parentSpanId: match[2]!,
    sampled: match[3] === '1' ? true : match[3] === '0' ? false : undefined,
  }
}

// =============================================================================
// Span Implementation
// =============================================================================

/**
 * Internal Span implementation.
 */
class SpanImpl implements Span {
  readonly spanId: string
  readonly traceId: string
  readonly parentSpanId?: string
  readonly op?: string
  readonly description?: string
  readonly startTimestamp: number
  endTimestamp?: number
  status?: SpanStatus
  data?: Record<string, unknown>
  tags?: Tags

  private readonly transaction: TransactionImpl
  private finished = false

  constructor(
    context: SpanContext,
    transaction: TransactionImpl,
    traceId: string,
    parentSpanId?: string
  ) {
    this.spanId = generateSpanId()
    this.traceId = traceId
    this.parentSpanId = parentSpanId
    this.op = context.op
    this.description = context.description
    this.startTimestamp = context.startTimestamp ?? Date.now() / 1000
    this.data = context.data ? { ...context.data } : undefined
    this.tags = context.tags ? { ...context.tags } : undefined
    this.transaction = transaction
  }

  startChild(context: SpanContext): Span {
    const child = new SpanImpl(context, this.transaction, this.traceId, this.spanId)
    this.transaction.registerSpan(child)
    return child
  }

  setStatus(status: SpanStatus): void {
    this.status = status
  }

  setHttpStatus(httpStatus: number): void {
    this.status = httpStatusToSpanStatus(httpStatus)
    this.setData('http.status_code', httpStatus)
  }

  setData(key: string, value: unknown): void {
    if (!this.data) {
      this.data = {}
    }
    this.data[key] = value
  }

  setTag(key: string, value: string): void {
    if (!this.tags) {
      this.tags = {}
    }
    this.tags[key] = value
  }

  finish(endTimestamp?: number): void {
    if (this.finished) {
      return
    }
    this.finished = true
    this.endTimestamp = endTimestamp ?? Date.now() / 1000
  }

  toTraceparent(): string {
    const sampled = this.transaction.sampled ? '01' : '00'
    return `00-${this.traceId}-${this.spanId}-${sampled}`
  }

  isFinished(): boolean {
    return this.finished
  }

  /**
   * Convert to Sentry span format for the transaction event.
   */
  toJSON(): Record<string, unknown> {
    return {
      trace_id: this.traceId,
      span_id: this.spanId,
      parent_span_id: this.parentSpanId,
      op: this.op,
      description: this.description,
      start_timestamp: this.startTimestamp,
      timestamp: this.endTimestamp,
      status: this.status,
      data: this.data,
      tags: this.tags,
    }
  }
}

// =============================================================================
// Transaction Implementation
// =============================================================================

/**
 * Internal Transaction implementation.
 */
class TransactionImpl implements Transaction {
  readonly spanId: string
  readonly traceId: string
  readonly parentSpanId?: string
  readonly name: string
  readonly op?: string
  readonly description?: string
  readonly startTimestamp: number
  endTimestamp?: number
  status?: SpanStatus
  data?: Record<string, unknown>
  tags?: Tags
  measurements?: Record<string, Measurement>
  sampled: boolean

  private spans: SpanImpl[] = []
  private finished = false
  private readonly hub: TransactionHub

  constructor(context: TransactionContext, hub: TransactionHub, options?: ContinueTraceOptions) {
    this.spanId = generateSpanId()
    this.hub = hub

    // Handle trace continuation
    if (options?.sentryTrace) {
      const parsed = parseSentryTrace(options.sentryTrace)
      if (parsed) {
        this.traceId = parsed.traceId
        this.parentSpanId = parsed.parentSpanId
        this.sampled = parsed.sampled ?? context.sampled ?? true
      } else {
        this.traceId = context.traceId ?? generateTraceId()
        this.parentSpanId = context.parentSpanId
        this.sampled = context.sampled ?? true
      }
    } else {
      this.traceId = context.traceId ?? generateTraceId()
      this.parentSpanId = context.parentSpanId
      this.sampled = context.sampled ?? true
    }

    this.name = context.name
    this.op = context.op
    this.description = context.description
    this.startTimestamp = context.startTimestamp ?? Date.now() / 1000
    this.data = context.data ? { ...context.data } : undefined
    this.tags = context.tags ? { ...context.tags } : undefined
  }

  registerSpan(span: SpanImpl): void {
    this.spans.push(span)
  }

  startChild(context: SpanContext): Span {
    const child = new SpanImpl(context, this, this.traceId, this.spanId)
    this.registerSpan(child)
    return child
  }

  setStatus(status: SpanStatus): void {
    this.status = status
  }

  setHttpStatus(httpStatus: number): void {
    this.status = httpStatusToSpanStatus(httpStatus)
    this.setData('http.status_code', httpStatus)
  }

  setData(key: string, value: unknown): void {
    if (!this.data) {
      this.data = {}
    }
    this.data[key] = value
  }

  setTag(key: string, value: string): void {
    if (!this.tags) {
      this.tags = {}
    }
    this.tags[key] = value
  }

  setMeasurement(name: string, value: number, unit: Measurement['unit']): void {
    if (!this.measurements) {
      this.measurements = {}
    }
    this.measurements[name] = { value, unit }
  }

  finish(endTimestamp?: number): void {
    if (this.finished) {
      return
    }
    this.finished = true
    this.endTimestamp = endTimestamp ?? Date.now() / 1000

    // Auto-finish any unfinished child spans
    for (const span of this.spans) {
      if (!span.isFinished()) {
        span.finish(this.endTimestamp)
      }
    }

    // Send the transaction
    this.hub.sendTransaction(this)
  }

  getSpans(): Span[] {
    return [...this.spans]
  }

  toTraceparent(): string {
    const sampled = this.sampled ? '01' : '00'
    return `00-${this.traceId}-${this.spanId}-${sampled}`
  }

  toBaggage(): string {
    const items: string[] = []
    items.push(`sentry-trace_id=${this.traceId}`)
    items.push(`sentry-public_key=${this.hub.getPublicKey() ?? ''}`)

    const options = this.hub.getOptions()
    if (options.release) {
      items.push(`sentry-release=${encodeURIComponent(options.release)}`)
    }
    if (options.environment) {
      items.push(`sentry-environment=${encodeURIComponent(options.environment)}`)
    }

    items.push(`sentry-sampled=${this.sampled}`)

    return items.join(',')
  }

  isFinished(): boolean {
    return this.finished
  }

  toEvent(): SentryEvent {
    const event: SentryEvent = {
      type: 'transaction',
      transaction: this.name,
      contexts: {
        trace: {
          trace_id: this.traceId,
          span_id: this.spanId,
          parent_span_id: this.parentSpanId,
          op: this.op,
          status: this.status,
          data: this.data,
        },
      },
      spans: this.spans.map((span) => (span as SpanImpl).toJSON()),
      start_timestamp: this.startTimestamp,
      timestamp: this.endTimestamp,
      tags: this.tags,
      measurements: this.measurements,
    }

    return event
  }
}

// =============================================================================
// Transaction Hub
// =============================================================================

interface TransactionHubOptions {
  dsn?: string
  release?: string
  environment?: string
  tracesSampleRate?: number
  sendTransaction?: (event: SentryEvent) => void
}

/**
 * Hub for managing transactions.
 */
class TransactionHub {
  private options: TransactionHubOptions
  private publicKey: string | undefined
  private activeTransaction: TransactionImpl | null = null
  private spanStack: Span[] = []

  constructor(options: TransactionHubOptions = {}) {
    this.options = options

    // Extract public key from DSN
    if (options.dsn) {
      const match = options.dsn.match(/\/\/([^@]+)@/)
      this.publicKey = match?.[1]
    }
  }

  getOptions(): TransactionHubOptions {
    return this.options
  }

  getPublicKey(): string | undefined {
    return this.publicKey
  }

  setActiveTransaction(transaction: TransactionImpl | null): void {
    this.activeTransaction = transaction
  }

  getActiveTransaction(): TransactionImpl | null {
    return this.activeTransaction
  }

  pushSpan(span: Span): void {
    this.spanStack.push(span)
  }

  popSpan(): Span | undefined {
    return this.spanStack.pop()
  }

  getCurrentSpan(): Span | undefined {
    return this.spanStack[this.spanStack.length - 1]
  }

  startTransaction(context: TransactionContext, options?: ContinueTraceOptions): Transaction {
    // Apply sampling
    const sampleRate = this.options.tracesSampleRate ?? 1.0
    const sampled = context.sampled ?? Math.random() < sampleRate

    const transaction = new TransactionImpl(
      { ...context, sampled },
      this,
      options
    )

    this.activeTransaction = transaction
    return transaction
  }

  sendTransaction(transaction: TransactionImpl): void {
    if (!transaction.sampled) {
      return
    }

    const event = transaction.toEvent()

    if (this.options.sendTransaction) {
      this.options.sendTransaction(event)
    }
  }
}

// =============================================================================
// Global Hub Instance
// =============================================================================

let globalTransactionHub: TransactionHub | undefined

function getTransactionHub(): TransactionHub {
  if (!globalTransactionHub) {
    globalTransactionHub = new TransactionHub()
  }
  return globalTransactionHub
}

/**
 * Configure the transaction hub.
 * @internal
 */
export function configureTransactionHub(options: TransactionHubOptions): void {
  globalTransactionHub = new TransactionHub(options)
}

/**
 * Clear the transaction hub.
 * @internal
 */
export function clearTransactionHub(): void {
  globalTransactionHub = undefined
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Start a new transaction.
 */
export function startTransaction(
  context: TransactionContext,
  options?: ContinueTraceOptions
): Transaction {
  return getTransactionHub().startTransaction(context, options)
}

/**
 * Start a span and execute a callback.
 * The span is automatically finished when the callback completes.
 */
export async function startSpan<T>(
  context: SpanContext & { name?: string },
  callback: (span: Span) => T | Promise<T>
): Promise<T> {
  const hub = getTransactionHub()
  const parentSpan = hub.getCurrentSpan() || hub.getActiveTransaction()

  let span: Span

  if (parentSpan) {
    span = parentSpan.startChild(context)
  } else {
    // Create a transaction if no parent exists
    const transaction = hub.startTransaction({
      name: context.name || context.op || 'anonymous',
      ...context,
    })
    span = transaction
  }

  hub.pushSpan(span)

  try {
    const result = await callback(span)
    span.finish()
    return result
  } catch (error) {
    span.setStatus('internal_error')
    span.finish()
    throw error
  } finally {
    hub.popSpan()
  }
}

/**
 * Get the current active span.
 */
export function getActiveSpan(): Span | undefined {
  const hub = getTransactionHub()
  return hub.getCurrentSpan() || hub.getActiveTransaction() || undefined
}

/**
 * Get the current active transaction.
 */
export function getActiveTransaction(): Transaction | undefined {
  return getTransactionHub().getActiveTransaction() || undefined
}

/**
 * Continue a trace from incoming headers.
 */
export function continueTrace(
  options: ContinueTraceOptions,
  callback: (transactionContext: Partial<TransactionContext>) => Transaction
): Transaction {
  let traceId: string | undefined
  let parentSpanId: string | undefined
  let sampled: boolean | undefined

  if (options.sentryTrace) {
    const parsed = parseSentryTrace(options.sentryTrace)
    if (parsed) {
      traceId = parsed.traceId
      parentSpanId = parsed.parentSpanId
      sampled = parsed.sampled
    }
  }

  return callback({
    traceId,
    parentSpanId,
    sampled,
  })
}
