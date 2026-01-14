/**
 * OTEL Span Transformer
 *
 * Transforms OpenTelemetry (OTLP) spans to the unified event schema.
 * Maps OTLP semantic conventions to unified schema fields.
 *
 * @module db/streams/transformers/otel-span
 */

import { createUnifiedEvent } from '../../../types/unified-event'
import type { UnifiedEvent } from '../../../types/unified-event'
import {
  flattenOtlpAttributes,
  getStringAttribute,
  getIntAttribute,
  nanoToIso,
  calculateDurationMs,
  deriveHour,
  deriveDay,
} from './shared/otel'
import type { OtlpAttribute, OtlpAttributeValue } from './shared/otel'

// Re-export types for consumers
export type { OtlpAttribute, OtlpAttributeValue }

// ============================================================================
// OTLP Span-Specific Type Definitions
// ============================================================================

/**
 * OTLP span kind enumeration.
 * @see https://opentelemetry.io/docs/reference/specification/trace/api/#spankind
 */
export enum SpanKind {
  /** Default value, unspecified */
  UNSPECIFIED = 0,
  /** Internal span, not exposed externally */
  INTERNAL = 1,
  /** Server-side span for RPC or HTTP requests */
  SERVER = 2,
  /** Client-side span for RPC or HTTP requests */
  CLIENT = 3,
  /** Producer span for messaging systems */
  PRODUCER = 4,
  /** Consumer span for messaging systems */
  CONSUMER = 5,
}

/**
 * OTLP status code enumeration.
 * @see https://opentelemetry.io/docs/reference/specification/trace/api/#set-status
 */
export enum StatusCode {
  /** Unset status (default) */
  UNSET = 0,
  /** Operation completed successfully */
  OK = 1,
  /** Operation failed with an error */
  ERROR = 2,
}

/**
 * OTLP span status.
 */
export interface OtlpStatus {
  code?: number
  message?: string
}

/**
 * OTLP span structure as defined by the OTLP protocol.
 * @see https://opentelemetry.io/docs/reference/specification/protocol/otlp/
 */
export interface OtlpSpan {
  /** Trace identifier (32 hex chars) */
  traceId: string
  /** Span identifier (16 hex chars) */
  spanId: string
  /** Parent span identifier (16 hex chars, optional) */
  parentSpanId?: string
  /** Span name */
  name: string
  /** Span kind (0-5) */
  kind: number
  /** Start time in nanoseconds since Unix epoch (as string for int64) */
  startTimeUnixNano: string
  /** End time in nanoseconds since Unix epoch (as string for int64) */
  endTimeUnixNano: string
  /** Span attributes */
  attributes?: OtlpAttribute[]
  /** Span status */
  status?: OtlpStatus
}

/**
 * OTLP resource structure containing service and host metadata.
 */
export interface OtlpResource {
  attributes?: OtlpAttribute[]
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generates a unique event ID from trace and span IDs.
 * Uses span_id as the base ID since it's already unique within a trace.
 */
function generateEventId(traceId: string, spanId: string): string {
  // Combine trace_id and span_id for global uniqueness
  return `span_${traceId}_${spanId}`
}

// ============================================================================
// Main Transform Function
// ============================================================================

/**
 * Transforms an OTLP span to a UnifiedEvent.
 *
 * Maps OTLP fields to unified schema:
 * - traceId → trace_id (lowercase hex)
 * - spanId → span_id (lowercase hex)
 * - parentSpanId → parent_id
 * - name → event_name
 * - kind → rpc_system or msg_operation based on type
 * - startTimeUnixNano → started_at, timestamp_ns
 * - endTimeUnixNano → ended_at
 * - duration calculated from start/end
 * - status.code → status_code, outcome
 * - attributes → attributes JSON
 * - resource.service.name → service_name
 *
 * @param span - The OTLP span to transform
 * @param resource - Optional OTLP resource with service metadata
 * @returns UnifiedEvent with all fields populated
 */
export function transformOtelSpan(
  span: OtlpSpan,
  resource?: OtlpResource
): UnifiedEvent {
  // Extract resource attributes
  const resourceAttrs = resource?.attributes
  const serviceName = getStringAttribute(resourceAttrs, 'service.name')
  const serviceVersion = getStringAttribute(resourceAttrs, 'service.version')
  const serviceInstance = getStringAttribute(resourceAttrs, 'service.instance.id')
  const serviceNamespace = getStringAttribute(resourceAttrs, 'service.namespace')
  const hostName = getStringAttribute(resourceAttrs, 'host.name')

  // Extract span attributes
  const spanAttrs = span.attributes
  const httpMethod = getStringAttribute(spanAttrs, 'http.method')
  const httpUrl = getStringAttribute(spanAttrs, 'http.url')
  const httpStatus = getIntAttribute(spanAttrs, 'http.status_code')
  const httpHost = getStringAttribute(spanAttrs, 'http.host')

  // Map span kind to appropriate fields
  let rpcSystem: string | null = null
  let msgOperation: string | null = null

  switch (span.kind) {
    case SpanKind.SERVER:
      rpcSystem = 'server'
      break
    case SpanKind.CLIENT:
      rpcSystem = 'client'
      break
    case SpanKind.PRODUCER:
      msgOperation = 'publish'
      break
    case SpanKind.CONSUMER:
      msgOperation = 'consume'
      break
    // INTERNAL, UNSPECIFIED - no special mapping
  }

  // Map status
  const statusCode = span.status?.code ?? null
  let outcome: string | null = null
  let errorMessage: string | null = null

  if (statusCode !== null) {
    switch (statusCode) {
      case StatusCode.OK:
        outcome = 'success'
        break
      case StatusCode.ERROR:
        outcome = 'error'
        errorMessage = span.status?.message ?? null
        break
      // UNSET has no outcome mapping
    }
  }

  // Flatten span attributes
  const flattenedAttrs = flattenOtlpAttributes(span.attributes)

  // Generate event
  return createUnifiedEvent({
    // CoreIdentity
    id: generateEventId(span.traceId, span.spanId),
    event_type: 'trace',
    event_name: span.name,
    ns: serviceNamespace ?? 'otel',

    // CausalityChain
    trace_id: span.traceId.toLowerCase(),
    span_id: span.spanId.toLowerCase(),
    parent_id: span.parentSpanId ? span.parentSpanId.toLowerCase() : null,

    // Timing
    started_at: nanoToIso(span.startTimeUnixNano),
    ended_at: nanoToIso(span.endTimeUnixNano),
    timestamp_ns: BigInt(span.startTimeUnixNano),
    duration_ms: calculateDurationMs(span.startTimeUnixNano, span.endTimeUnixNano),

    // Outcome
    status_code: statusCode,
    outcome,
    error_message: errorMessage,

    // ServiceInfra
    service_name: serviceName,
    service_version: serviceVersion,
    service_instance: serviceInstance,
    service_namespace: serviceNamespace,
    host_name: hostName,

    // HttpContext (from semantic conventions)
    http_method: httpMethod,
    http_url: httpUrl,
    http_status: httpStatus,
    http_host: httpHost,

    // RPC
    rpc_system: rpcSystem,

    // Messaging
    msg_operation: msgOperation,

    // FlexiblePayloads
    attributes: flattenedAttrs,

    // PartitionInternal
    hour: deriveHour(span.startTimeUnixNano),
    day: deriveDay(span.startTimeUnixNano),
    event_source: 'otel',
  })
}
