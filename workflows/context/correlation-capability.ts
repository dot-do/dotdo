/**
 * Correlation Capability for WorkflowContext
 *
 * Provides distributed tracing capabilities via $.correlation:
 * - $.correlation.id - Get current correlation ID
 * - $.correlation.spanId - Get current span ID
 * - $.correlation.context - Get full correlation context
 * - $.correlation.span(name) - Create a child span for sub-operations
 * - $.correlation.create() - Create a new correlation context
 * - $.correlation.setContext(ctx) - Set the correlation context
 * - $.correlation.setAttribute(key, value) - Add attribute to current span
 * - $.correlation.addEvent(name, attrs) - Add event to current span
 *
 * Integrates with cross-DO RPC for automatic context propagation.
 *
 * @module workflows/context/correlation-capability
 */

import {
  type CorrelationContext,
  generateCorrelationId,
  generateRequestId,
} from './correlation'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Span represents a unit of work within a trace
 */
export interface Span {
  /** Unique span identifier */
  id: string
  /** Name of the operation */
  name: string
  /** Parent span ID (if nested) */
  parentId?: string
  /** Correlation ID (trace ID) */
  correlationId: string
  /** Start time */
  startedAt: Date
  /** End time (set when span ends) */
  endedAt?: Date
  /** Duration in milliseconds (computed when ended) */
  durationMs?: number
  /** Status of the span */
  status: 'active' | 'completed' | 'failed'
  /** Attributes/tags for the span */
  attributes: Record<string, string | number | boolean>
  /** Events within the span */
  events: SpanEvent[]
}

/**
 * Event within a span (for logging key moments)
 */
export interface SpanEvent {
  /** Event name */
  name: string
  /** Timestamp */
  timestamp: Date
  /** Event attributes */
  attributes?: Record<string, string | number | boolean>
}

/**
 * Span builder for fluent span creation
 */
export interface SpanBuilder {
  /** Set an attribute on the span */
  setAttribute(key: string, value: string | number | boolean): SpanBuilder
  /** Add an event to the span */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): SpanBuilder
  /** Execute a function within the span context */
  run<T>(fn: () => T | Promise<T>): Promise<T>
  /** End the span manually */
  end(status?: 'completed' | 'failed'): void
  /** Get the span object */
  getSpan(): Span
}

/**
 * Correlation capability interface on WorkflowContext
 */
export interface CorrelationCapability {
  /** Get the current correlation ID */
  readonly id: string

  /** Get the current span ID */
  readonly spanId: string | undefined

  /** Get the full correlation context */
  readonly context: CorrelationContext

  /**
   * Create a child span for tracing a sub-operation
   * @param name - Name of the operation being traced
   * @returns A SpanBuilder with methods to manage the span
   */
  span(name: string): SpanBuilder

  /**
   * Add an attribute to the current span
   * @param key - Attribute key
   * @param value - Attribute value
   */
  setAttribute(key: string, value: string | number | boolean): void

  /**
   * Add an event to the current span
   * @param name - Event name
   * @param attributes - Optional event attributes
   */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void

  /**
   * Create a new correlation context (for root requests)
   */
  create(): CorrelationContext

  /**
   * Set the correlation context (for incoming requests)
   * @param ctx - The correlation context to use
   */
  setContext(ctx: CorrelationContext): void
}

/**
 * Storage interface for correlation state
 */
export interface CorrelationStore {
  context: CorrelationContext | null
  spans: Map<string, Span>
  currentSpanId: string | undefined
}

// ============================================================================
// ID GENERATION
// ============================================================================

/**
 * Generates a unique span ID
 */
function generateSpanId(): string {
  const random = crypto.getRandomValues(new Uint8Array(4))
  return `span-${Array.from(random).map(b => b.toString(16).padStart(2, '0')).join('')}`
}

// ============================================================================
// SPAN BUILDER IMPLEMENTATION
// ============================================================================

/**
 * Creates a SpanBuilder for managing a span
 */
function createSpanBuilder(
  store: CorrelationStore,
  span: Span
): SpanBuilder {
  const parentSpanId = store.currentSpanId

  const builder: SpanBuilder = {
    setAttribute(key: string, value: string | number | boolean): SpanBuilder {
      span.attributes[key] = value
      return builder
    },

    addEvent(name: string, attributes?: Record<string, string | number | boolean>): SpanBuilder {
      span.events.push({
        name,
        timestamp: new Date(),
        attributes,
      })
      return builder
    },

    async run<T>(fn: () => T | Promise<T>): Promise<T> {
      // Set this span as current
      const previousSpanId = store.currentSpanId
      store.currentSpanId = span.id
      store.spans.set(span.id, span)

      try {
        const result = await Promise.resolve(fn())
        builder.end('completed')
        return result
      } catch (error) {
        builder.end('failed')
        throw error
      } finally {
        // Restore previous span
        store.currentSpanId = previousSpanId
      }
    },

    end(status: 'completed' | 'failed' = 'completed'): void {
      // Only end if not already ended
      if (span.status === 'active') {
        span.status = status
        span.endedAt = new Date()
        span.durationMs = span.endedAt.getTime() - span.startedAt.getTime()
      }
    },

    getSpan(): Span {
      return span
    },
  }

  return builder
}

// ============================================================================
// CORRELATION CAPABILITY IMPLEMENTATION
// ============================================================================

/**
 * Creates a CorrelationCapability instance
 *
 * @param store - The storage for correlation state
 * @returns A CorrelationCapability object
 *
 * @example
 * ```typescript
 * const store: CorrelationStore = {
 *   context: null,
 *   spans: new Map(),
 *   currentSpanId: undefined,
 * }
 *
 * const correlation = createCorrelationCapability(store)
 *
 * // Create new context
 * const ctx = correlation.create()
 * correlation.setContext(ctx)
 *
 * // Create and run a span
 * const result = await correlation.span('process-order')
 *   .setAttribute('order.id', '12345')
 *   .run(async () => {
 *     // ... process order
 *     return { success: true }
 *   })
 * ```
 */
export function createCorrelationCapability(store: CorrelationStore): CorrelationCapability {
  return {
    get id(): string {
      if (!store.context) {
        throw new Error('No correlation context set')
      }
      return store.context.correlationId
    },

    get spanId(): string | undefined {
      return store.currentSpanId ?? store.context?.spanId
    },

    get context(): CorrelationContext {
      if (!store.context) {
        throw new Error('No correlation context set')
      }
      return store.context
    },

    span(name: string): SpanBuilder {
      if (!store.context) {
        throw new Error('No correlation context set')
      }

      const span: Span = {
        id: generateSpanId(),
        name,
        parentId: store.currentSpanId,
        correlationId: store.context.correlationId,
        startedAt: new Date(),
        status: 'active',
        attributes: {},
        events: [],
      }

      store.spans.set(span.id, span)

      return createSpanBuilder(store, span)
    },

    setAttribute(key: string, value: string | number | boolean): void {
      if (!store.currentSpanId) {
        // Silently ignore if no current span
        return
      }

      const span = store.spans.get(store.currentSpanId)
      if (span) {
        span.attributes[key] = value
      }
    },

    addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
      if (!store.currentSpanId) {
        // Silently ignore if no current span
        return
      }

      const span = store.spans.get(store.currentSpanId)
      if (span) {
        span.events.push({
          name,
          timestamp: new Date(),
          attributes,
        })
      }
    },

    create(): CorrelationContext {
      return {
        correlationId: generateCorrelationId(),
        requestId: generateRequestId(),
        timestamp: Date.now(),
        sequence: 1,
        spanId: generateSpanId(),
      }
    },

    setContext(ctx: CorrelationContext): void {
      store.context = ctx
      // If the context has a spanId, use it as the current span reference
      // (but don't create a span object for it - it's just a reference)
    },
  }
}

// ============================================================================
// FACTORY FOR WORKFLOW CONTEXT
// ============================================================================

/**
 * Creates a correlation capability for a workflow context.
 * This factory creates the store and capability together.
 *
 * @returns An object containing the capability and its store
 */
export function createCorrelationContext(): {
  correlation: CorrelationCapability
  store: CorrelationStore
} {
  const store: CorrelationStore = {
    context: null,
    spans: new Map(),
    currentSpanId: undefined,
  }

  const correlation = createCorrelationCapability(store)

  return { correlation, store }
}

// ============================================================================
// UTILITY FUNCTIONS FOR DO INTEGRATION
// ============================================================================

/**
 * Creates a child correlation context for cross-DO calls.
 * Preserves the correlation ID but creates new request/span IDs.
 *
 * @param parent - The parent correlation context
 * @returns A new child correlation context
 */
export function createChildContext(parent: CorrelationContext): CorrelationContext {
  return {
    correlationId: parent.correlationId,
    requestId: generateRequestId(),
    timestamp: Date.now(),
    sequence: parent.sequence + 1,
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
  }
}

/**
 * Wraps an action with correlation tracking.
 * Use this in $.do() implementation to automatically create spans.
 *
 * @param correlation - The correlation capability
 * @param actionName - Name of the action being executed
 * @param options - Additional options for the span
 * @returns A function that wraps the action with span tracking
 *
 * @example
 * ```typescript
 * const result = await wrapWithCorrelation(
 *   this.$.correlation,
 *   'send.email',
 *   { stepId: 'step-123', durability: 'durable' }
 * )(async () => {
 *   return await sendEmail(to, subject, body)
 * })
 * ```
 */
export function wrapWithCorrelation<T>(
  correlation: CorrelationCapability,
  actionName: string,
  options?: {
    stepId?: string
    durability?: 'send' | 'try' | 'do'
    retries?: number
    maxAttempts?: number
  }
): (fn: () => T | Promise<T>) => Promise<T> {
  return async (fn: () => T | Promise<T>): Promise<T> => {
    const spanBuilder = correlation.span(`do:${actionName}`)
      .setAttribute('action.name', actionName)

    if (options?.durability) {
      spanBuilder.setAttribute('action.durability', options.durability)
    }

    if (options?.stepId) {
      spanBuilder.setAttribute('action.stepId', options.stepId)
    }

    if (options?.retries !== undefined) {
      spanBuilder.setAttribute('action.retries', options.retries)
    }

    if (options?.maxAttempts !== undefined) {
      spanBuilder.setAttribute('action.maxAttempts', options.maxAttempts)
    }

    return spanBuilder.run(fn)
  }
}
