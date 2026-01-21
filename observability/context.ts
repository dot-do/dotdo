/**
 * Context Propagation for dotdo
 *
 * Provides request-scoped context propagation using AsyncLocalStorage with:
 * - Automatic trace context propagation across async boundaries
 * - Correlation ID management
 * - Baggage items (key-value pairs propagated with context)
 * - Integration with structured logging and tracing
 *
 * @module observability/context
 */

import type { SpanContext, Span } from './tracing'
import { generateSpanId, generateTraceId } from './tracing'

/**
 * Baggage items - key-value pairs propagated with the context
 */
export type Baggage = Map<string, string>

/**
 * Observability context - carries trace context and metadata across async boundaries
 */
export interface ObservabilityContext {
  /** Correlation ID for request tracing */
  correlationId: string
  /** Trace context for distributed tracing */
  traceContext?: SpanContext
  /** Currently active span (explicitly allows undefined for clearing) */
  activeSpan?: Span | undefined
  /** Baggage items */
  baggage: Baggage
  /** Additional metadata */
  metadata: Record<string, unknown>
}

/**
 * Storage key for the observability context
 */
const CONTEXT_KEY = Symbol('observabilityContext')

/**
 * Current context stack (for environments without AsyncLocalStorage)
 */
let contextStack: ObservabilityContext[] = []

/**
 * AsyncLocalStorage type (for compatibility)
 */
interface AsyncLocalStorageType<T> {
  getStore(): T | undefined
  run<R>(store: T, callback: () => R): R
}

/**
 * Type for globalThis with optional AsyncLocalStorage.
 * AsyncLocalStorage is available in Cloudflare Workers (2024+) and Node.js.
 */
interface GlobalWithAsyncLocalStorage {
  AsyncLocalStorage?: new <T>() => AsyncLocalStorageType<T>
}

/**
 * AsyncLocalStorage instance (if available)
 */
let asyncLocalStorage: AsyncLocalStorageType<ObservabilityContext> | undefined

// AsyncLocalStorage is available in Cloudflare Workers as of 2024
// but we provide a fallback for testing environments
try {
  // AsyncLocalStorage is a global in Workers but not in standard TypeScript lib
  const globalWithALS = globalThis as GlobalWithAsyncLocalStorage
  const AsyncLocalStorageClass = globalWithALS.AsyncLocalStorage
  if (typeof AsyncLocalStorageClass !== 'undefined') {
    asyncLocalStorage = new AsyncLocalStorageClass()
  }
} catch {
  // AsyncLocalStorage not available, use fallback
}

/**
 * Generate a unique correlation ID
 */
export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${generateSpanId().slice(0, 8)}`
}

/**
 * Create a new observability context
 */
export function createObservabilityContext(
  options: Partial<ObservabilityContext> = {}
): ObservabilityContext {
  const ctx: ObservabilityContext = {
    correlationId: options.correlationId ?? generateCorrelationId(),
    baggage: options.baggage ?? new Map(),
    metadata: options.metadata ?? {},
  }
  if (options.traceContext !== undefined) {
    ctx.traceContext = options.traceContext
  }
  if (options.activeSpan !== undefined) {
    ctx.activeSpan = options.activeSpan
  }
  return ctx
}

/**
 * Get the current observability context
 */
export function getContext(): ObservabilityContext | undefined {
  if (asyncLocalStorage) {
    return asyncLocalStorage.getStore()
  }
  return contextStack[contextStack.length - 1]
}

/**
 * Get the current context or create a new one
 */
export function getOrCreateContext(): ObservabilityContext {
  const current = getContext()
  if (current) return current
  return createObservabilityContext()
}

/**
 * Run a function with a specific observability context
 */
export function runWithContext<T>(
  context: ObservabilityContext,
  fn: () => T
): T {
  if (asyncLocalStorage) {
    return asyncLocalStorage.run(context, fn)
  }

  // Fallback for environments without AsyncLocalStorage
  contextStack.push(context)
  try {
    return fn()
  } finally {
    contextStack.pop()
  }
}

/**
 * Run a function with a new observability context
 */
export function runInNewContext<T>(
  options: Partial<ObservabilityContext> = {},
  fn: () => T
): T {
  const context = createObservabilityContext(options)
  return runWithContext(context, fn)
}

/**
 * Run a function with context derived from the current context
 */
export function runWithChildContext<T>(
  updates: Partial<ObservabilityContext>,
  fn: () => T
): T {
  const parent = getContext()
  // Build context options conditionally to satisfy exactOptionalPropertyTypes
  const correlationId = parent?.correlationId ?? updates.correlationId
  const traceContext = updates.traceContext ?? parent?.traceContext
  const activeSpan = updates.activeSpan ?? parent?.activeSpan
  const options: Partial<ObservabilityContext> = {
    baggage: new Map([
      ...(parent?.baggage ?? new Map()),
      ...(updates.baggage ?? new Map()),
    ]),
    metadata: {
      ...(parent?.metadata ?? {}),
      ...(updates.metadata ?? {}),
    },
  }
  if (correlationId !== undefined) {
    options.correlationId = correlationId
  }
  if (traceContext !== undefined) {
    options.traceContext = traceContext
  }
  if (activeSpan !== undefined) {
    options.activeSpan = activeSpan
  }
  const child = createObservabilityContext(options)
  return runWithContext(child, fn)
}

/**
 * Get the current correlation ID
 */
export function getCorrelationId(): string | undefined {
  return getContext()?.correlationId
}

/**
 * Get the current trace context
 */
export function getTraceContext(): SpanContext | undefined {
  return getContext()?.traceContext
}

/**
 * Get the current active span
 */
export function getActiveSpan(): Span | undefined {
  return getContext()?.activeSpan
}

/**
 * Set the active span in the current context
 */
export function setActiveSpan(span: Span | undefined): void {
  const ctx = getContext()
  if (ctx) {
    ctx.activeSpan = span
    if (span) {
      ctx.traceContext = span.context()
    }
  }
}

/**
 * Get a baggage item
 */
export function getBaggageItem(key: string): string | undefined {
  return getContext()?.baggage.get(key)
}

/**
 * Set a baggage item in the current context
 */
export function setBaggageItem(key: string, value: string): void {
  const ctx = getContext()
  if (ctx) {
    ctx.baggage.set(key, value)
  }
}

/**
 * Get all baggage items
 */
export function getAllBaggage(): Baggage {
  return getContext()?.baggage ?? new Map()
}

/**
 * Get metadata from the current context
 */
export function getMetadata(key: string): unknown {
  return getContext()?.metadata[key]
}

/**
 * Set metadata in the current context
 */
export function setMetadata(key: string, value: unknown): void {
  const ctx = getContext()
  if (ctx) {
    ctx.metadata[key] = value
  }
}

/**
 * W3C Baggage header name
 */
export const BAGGAGE_HEADER = 'baggage'

/**
 * Custom correlation ID header
 * Note: Uses X-Correlation-ID (mixed case) for consistency with RPC layer
 * HTTP headers are case-insensitive per RFC 7230, but we use consistent casing
 */
export const CORRELATION_ID_HEADER = 'X-Correlation-ID'

/**
 * Parse W3C baggage header
 * Format: key1=value1,key2=value2;property1;property2
 */
export function parseBaggage(header: string): Baggage {
  const baggage = new Map<string, string>()

  if (!header) return baggage

  const items = header.split(',')
  for (const item of items) {
    const [keyValue] = item.split(';')
    if (!keyValue) continue

    const [key, value] = keyValue.split('=').map(s => s.trim())
    if (key && value !== undefined) {
      try {
        baggage.set(decodeURIComponent(key), decodeURIComponent(value))
      } catch {
        // Skip invalid encoded values
      }
    }
  }

  return baggage
}

/**
 * Format baggage as W3C baggage header
 */
export function formatBaggage(baggage: Baggage): string {
  const items: string[] = []

  for (const [key, value] of baggage) {
    items.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  }

  return items.join(',')
}

/**
 * Extract observability context from HTTP headers
 */
export function extractContextFromHeaders(
  headers: Headers | Record<string, string>
): Partial<ObservabilityContext> {
  const get = (name: string): string | null => {
    if (headers instanceof Headers) {
      return headers.get(name)
    }
    return headers[name] ?? null
  }

  const result: Partial<ObservabilityContext> = {}

  // Extract correlation ID
  const correlationId = get(CORRELATION_ID_HEADER)
  if (correlationId) {
    result.correlationId = correlationId
  }

  // Extract baggage
  const baggageHeader = get(BAGGAGE_HEADER)
  if (baggageHeader) {
    result.baggage = parseBaggage(baggageHeader)
  }

  return result
}

/**
 * Inject observability context into HTTP headers
 */
export function injectContextToHeaders(
  headers: Headers,
  context?: ObservabilityContext
): void {
  const ctx = context ?? getContext()
  if (!ctx) return

  // Inject correlation ID
  headers.set(CORRELATION_ID_HEADER, ctx.correlationId)

  // Inject baggage
  if (ctx.baggage.size > 0) {
    headers.set(BAGGAGE_HEADER, formatBaggage(ctx.baggage))
  }
}

/**
 * Context holder for request processing
 */
export interface ContextHolder {
  /** Get the current context */
  get(): ObservabilityContext | undefined
  /** Run with context */
  run<T>(fn: () => T): T
  /** Get correlation ID */
  correlationId: string
  /** Get/set active span */
  span: Span | undefined
  /** Baggage operations */
  baggage: {
    get(key: string): string | undefined
    set(key: string, value: string): void
    getAll(): Baggage
  }
  /** Metadata operations */
  metadata: {
    get(key: string): unknown
    set(key: string, value: unknown): void
  }
}

/**
 * Create a context holder for convenient context access
 */
export function createContextHolder(
  initial?: Partial<ObservabilityContext>
): ContextHolder {
  const context = createObservabilityContext(initial)

  return {
    get(): ObservabilityContext {
      return context
    },

    run<T>(fn: () => T): T {
      return runWithContext(context, fn)
    },

    get correlationId(): string {
      return context.correlationId
    },

    get span(): Span | undefined {
      return context.activeSpan
    },

    set span(value: Span | undefined) {
      context.activeSpan = value
      if (value) {
        context.traceContext = value.context()
      }
    },

    baggage: {
      get(key: string): string | undefined {
        return context.baggage.get(key)
      },

      set(key: string, value: string): void {
        context.baggage.set(key, value)
      },

      getAll(): Baggage {
        return context.baggage
      },
    },

    metadata: {
      get(key: string): unknown {
        return context.metadata[key]
      },

      set(key: string, value: unknown): void {
        context.metadata[key] = value
      },
    },
  }
}

/**
 * Reset context stack (for testing)
 */
export function resetContextStack(): void {
  contextStack = []
}
