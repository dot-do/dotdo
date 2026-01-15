/**
 * Transformer Registry
 *
 * A centralized registry for all event transformers in the unified event system.
 * Enables dynamic transformer lookup, plugin-style registration, and consistent
 * transformation across different event sources.
 *
 * Built-in transformers:
 * - otel-span: OpenTelemetry distributed tracing spans
 * - otel-log: OpenTelemetry log records
 * - otel-metric: OpenTelemetry metrics (gauge, counter, histogram, summary)
 * - segment-track: Segment-style user action tracking
 * - segment-identify: Segment-style identity events
 * - segment-page: Segment-style page view events
 * - cdc: Change Data Capture events
 * - do-event: Durable Object events
 * - do-action: Durable Object actions
 * - web-vital: Core Web Vitals metrics
 * - session-replay: rrweb session replay events
 * - snippet: Browser snippet proxy timing events
 * - tail: Workers tail log events
 * - epcis: GS1 EPCIS supply chain events
 *
 * @module db/streams/transformers/registry
 */

import type { UnifiedEvent } from '../../../types/unified-event'

// ============================================================================
// Types
// ============================================================================

/**
 * Generic transformer function type.
 * Takes any input and returns one or more UnifiedEvents.
 */
export type TransformerFn<TInput = unknown, TContext = unknown> = (
  input: TInput,
  context?: TContext
) => UnifiedEvent | UnifiedEvent[]

/**
 * Transformer metadata for documentation and introspection.
 */
export interface TransformerMeta {
  /** Human-readable name */
  name: string
  /** Description of what the transformer does */
  description: string
  /** Event source system (e.g., 'otel', 'segment', 'rrweb') */
  source: string
  /** Target event_type in UnifiedEvent (e.g., 'trace', 'track', 'replay') */
  eventType: string
  /** Whether the transformer can return multiple events */
  multipleOutputs: boolean
}

/**
 * Registered transformer with function and metadata.
 */
export interface RegisteredTransformer<TInput = unknown, TContext = unknown> {
  fn: TransformerFn<TInput, TContext>
  meta: TransformerMeta
}

// ============================================================================
// TransformerRegistry Class
// ============================================================================

/**
 * Registry for event transformers.
 *
 * Provides:
 * - Registration of named transformers
 * - Lookup by name
 * - Listing all registered transformers
 * - Direct transformation by name
 *
 * @example
 * ```typescript
 * import { registry } from './registry'
 *
 * // Register a custom transformer
 * registry.register('my-custom', myTransformer, {
 *   name: 'My Custom Transformer',
 *   description: 'Transforms custom events',
 *   source: 'custom',
 *   eventType: 'track',
 *   multipleOutputs: false,
 * })
 *
 * // Use the transformer
 * const events = registry.transform('my-custom', inputData)
 * ```
 */
export class TransformerRegistry {
  private transformers = new Map<string, RegisteredTransformer>()

  /**
   * Register a transformer with metadata.
   *
   * @param name - Unique name for the transformer
   * @param fn - Transformer function
   * @param meta - Transformer metadata
   * @throws Error if transformer name is already registered
   */
  register<TInput = unknown, TContext = unknown>(
    name: string,
    fn: TransformerFn<TInput, TContext>,
    meta: TransformerMeta
  ): void {
    if (this.transformers.has(name)) {
      throw new Error(`Transformer '${name}' is already registered`)
    }
    this.transformers.set(name, { fn: fn as TransformerFn, meta })
  }

  /**
   * Unregister a transformer.
   *
   * @param name - Name of the transformer to remove
   * @returns true if removed, false if not found
   */
  unregister(name: string): boolean {
    return this.transformers.delete(name)
  }

  /**
   * Check if a transformer is registered.
   *
   * @param name - Transformer name to check
   * @returns true if registered
   */
  has(name: string): boolean {
    return this.transformers.has(name)
  }

  /**
   * Get a registered transformer by name.
   *
   * @param name - Transformer name
   * @returns Registered transformer or undefined if not found
   */
  get(name: string): RegisteredTransformer | undefined {
    return this.transformers.get(name)
  }

  /**
   * Get just the transformer function by name.
   *
   * @param name - Transformer name
   * @returns Transformer function or undefined if not found
   */
  getFunction(name: string): TransformerFn | undefined {
    return this.transformers.get(name)?.fn
  }

  /**
   * List all registered transformer names.
   *
   * @returns Array of transformer names
   */
  list(): string[] {
    return Array.from(this.transformers.keys())
  }

  /**
   * List all registered transformers with metadata.
   *
   * @returns Array of [name, metadata] tuples
   */
  listWithMeta(): Array<[string, TransformerMeta]> {
    return Array.from(this.transformers.entries()).map(
      ([name, { meta }]) => [name, meta]
    )
  }

  /**
   * List transformers by event source.
   *
   * @param source - Event source to filter by (e.g., 'otel', 'segment')
   * @returns Array of transformer names matching the source
   */
  listBySource(source: string): string[] {
    return Array.from(this.transformers.entries())
      .filter(([, { meta }]) => meta.source === source)
      .map(([name]) => name)
  }

  /**
   * List transformers by event type.
   *
   * @param eventType - Event type to filter by (e.g., 'trace', 'track')
   * @returns Array of transformer names matching the event type
   */
  listByEventType(eventType: string): string[] {
    return Array.from(this.transformers.entries())
      .filter(([, { meta }]) => meta.eventType === eventType)
      .map(([name]) => name)
  }

  /**
   * Transform input data using a named transformer.
   *
   * @param name - Transformer name
   * @param input - Input data to transform
   * @param context - Optional context for the transformer
   * @returns Transformed UnifiedEvent(s)
   * @throws Error if transformer not found
   */
  transform(
    name: string,
    input: unknown,
    context?: unknown
  ): UnifiedEvent | UnifiedEvent[] {
    const transformer = this.transformers.get(name)
    if (!transformer) {
      throw new Error(`Unknown transformer: ${name}`)
    }
    return transformer.fn(input, context)
  }

  /**
   * Transform input and always return an array of events.
   *
   * @param name - Transformer name
   * @param input - Input data to transform
   * @param context - Optional context for the transformer
   * @returns Array of UnifiedEvents
   * @throws Error if transformer not found
   */
  transformToArray(
    name: string,
    input: unknown,
    context?: unknown
  ): UnifiedEvent[] {
    const result = this.transform(name, input, context)
    return Array.isArray(result) ? result : [result]
  }

  /**
   * Get count of registered transformers.
   */
  get size(): number {
    return this.transformers.size
  }

  /**
   * Clear all registered transformers.
   * Useful for testing.
   */
  clear(): void {
    this.transformers.clear()
  }
}

// ============================================================================
// Singleton Registry Instance
// ============================================================================

/**
 * Global transformer registry instance.
 *
 * Pre-populated with all built-in transformers.
 */
export const registry = new TransformerRegistry()

// ============================================================================
// Register Built-in Transformers
// ============================================================================

// Import all transformers
import { transformOtelSpan, type OtlpSpan, type OtlpResource } from './otel-span'
import { transformOtelLog, type OtlpLogRecord, type OtlpResource as OtlpLogResource } from './otel-log'
import { transformOtelMetric, type OtlpMetric, type OtlpResource as OtlpMetricResource } from './otel-metric'
import { transformSegmentTrack, type SegmentTrackEvent } from './segment-track'
import { transformSegmentIdentify, type SegmentIdentifyEvent } from './segment-identify'
import { transformSegmentPage, type SegmentPageEvent } from './segment-page'
import { transformCdcEvent, type CdcEvent } from './cdc'
import { transformDoEvent, type DoEventInput } from './do-event'
import { transformDoAction, type ActionInput } from './do-action'
import { transformWebVital, type WebVitalMetric, type TransformContext as WebVitalContext } from './web-vital'
import { transformSessionReplay, type RrwebEvent, type SessionReplayContext } from './session-replay'
import { transformSnippet, type SnippetEvent } from './snippet'
import { transformTailEvent, type TailEvent } from './tail'
import { transformEPCISEvent, type EPCISEvent, type EPCISTransformContext } from './business-epcis'

// Register OTEL transformers
registry.register<OtlpSpan, OtlpResource>(
  'otel-span',
  transformOtelSpan,
  {
    name: 'OpenTelemetry Span',
    description: 'Transforms OTLP distributed tracing spans to UnifiedEvent',
    source: 'otel',
    eventType: 'trace',
    multipleOutputs: false,
  }
)

registry.register<OtlpLogRecord, OtlpLogResource>(
  'otel-log',
  transformOtelLog,
  {
    name: 'OpenTelemetry Log',
    description: 'Transforms OTLP log records to UnifiedEvent',
    source: 'otel',
    eventType: 'log',
    multipleOutputs: false,
  }
)

registry.register<OtlpMetric, OtlpMetricResource>(
  'otel-metric',
  transformOtelMetric,
  {
    name: 'OpenTelemetry Metric',
    description: 'Transforms OTLP metrics to UnifiedEvent (one event per datapoint)',
    source: 'otel',
    eventType: 'metric',
    multipleOutputs: true,
  }
)

// Register Segment transformers
registry.register<SegmentTrackEvent, string>(
  'segment-track',
  transformSegmentTrack,
  {
    name: 'Segment Track',
    description: 'Transforms Segment-style track events to UnifiedEvent',
    source: 'segment',
    eventType: 'track',
    multipleOutputs: false,
  }
)

registry.register<SegmentIdentifyEvent, string>(
  'segment-identify',
  transformSegmentIdentify,
  {
    name: 'Segment Identify',
    description: 'Transforms Segment-style identify events to UnifiedEvent',
    source: 'segment',
    eventType: 'track',
    multipleOutputs: false,
  }
)

registry.register<SegmentPageEvent, string>(
  'segment-page',
  transformSegmentPage,
  {
    name: 'Segment Page',
    description: 'Transforms Segment-style page view events to UnifiedEvent',
    source: 'segment',
    eventType: 'page',
    multipleOutputs: false,
  }
)

// Register CDC transformer
registry.register<CdcEvent, string>(
  'cdc',
  transformCdcEvent,
  {
    name: 'Change Data Capture',
    description: 'Transforms database change events to UnifiedEvent',
    source: 'cdc',
    eventType: 'cdc',
    multipleOutputs: false,
  }
)

// Register DO transformers
registry.register<DoEventInput, string>(
  'do-event',
  transformDoEvent,
  {
    name: 'Durable Object Event',
    description: 'Transforms DO events to UnifiedEvent',
    source: 'durable-object',
    eventType: 'track',
    multipleOutputs: false,
  }
)

registry.register<ActionInput, string>(
  'do-action',
  transformDoAction,
  {
    name: 'Durable Object Action',
    description: 'Transforms DO actions to UnifiedEvent',
    source: 'durable-object',
    eventType: 'track',
    multipleOutputs: false,
  }
)

// Register Web Vitals transformer
registry.register<WebVitalMetric, WebVitalContext>(
  'web-vital',
  transformWebVital,
  {
    name: 'Web Vitals',
    description: 'Transforms Core Web Vitals metrics to UnifiedEvent',
    source: 'web-vitals',
    eventType: 'vital',
    multipleOutputs: false,
  }
)

// Register Session Replay transformer
registry.register<RrwebEvent, SessionReplayContext>(
  'session-replay',
  transformSessionReplay,
  {
    name: 'Session Replay',
    description: 'Transforms rrweb session replay events to UnifiedEvent',
    source: 'rrweb',
    eventType: 'replay',
    multipleOutputs: false,
  }
)

// Register Snippet transformer
registry.register<SnippetEvent, string>(
  'snippet',
  transformSnippet,
  {
    name: 'Browser Snippet',
    description: 'Transforms browser resource timing events to UnifiedEvent',
    source: 'snippet',
    eventType: 'snippet',
    multipleOutputs: false,
  }
)

// Register Tail transformer
registry.register<TailEvent, string>(
  'tail',
  transformTailEvent,
  {
    name: 'Workers Tail',
    description: 'Transforms Workers tail log events to UnifiedEvent',
    source: 'workers',
    eventType: 'tail',
    multipleOutputs: false,
  }
)

// Register EPCIS transformer
registry.register<EPCISEvent, EPCISTransformContext>(
  'epcis',
  transformEPCISEvent,
  {
    name: 'GS1 EPCIS',
    description: 'Transforms GS1 EPCIS supply chain events to UnifiedEvent',
    source: 'epcis',
    eventType: 'track',
    multipleOutputs: false,
  }
)

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * All registered transformer names.
 */
export const TRANSFORMER_NAMES = [
  'otel-span',
  'otel-log',
  'otel-metric',
  'segment-track',
  'segment-identify',
  'segment-page',
  'cdc',
  'do-event',
  'do-action',
  'web-vital',
  'session-replay',
  'snippet',
  'tail',
  'epcis',
] as const

export type TransformerName = (typeof TRANSFORMER_NAMES)[number]
