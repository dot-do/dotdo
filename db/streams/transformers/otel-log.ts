/**
 * OTEL Log Transformer
 *
 * Transforms OpenTelemetry log records into the unified event schema.
 *
 * OTEL Severity Number mapping (per OTEL spec):
 * - 1-4: TRACE
 * - 5-8: DEBUG
 * - 9-12: INFO
 * - 13-16: WARN
 * - 17-20: ERROR
 * - 21-24: FATAL
 *
 * @module db/streams/transformers/otel-log
 */

import { createUnifiedEvent, type UnifiedEvent } from '../../../types/unified-event'

// ============================================================================
// Types
// ============================================================================

/**
 * OTEL attribute value types
 */
interface OtlpAttributeValue {
  stringValue?: string
  intValue?: number
  doubleValue?: number
  boolValue?: boolean
  arrayValue?: {
    values: Array<{ stringValue?: string; intValue?: number; doubleValue?: number; boolValue?: boolean }>
  }
  kvlistValue?: unknown
}

/**
 * OTEL log record body
 */
interface OtlpBody {
  stringValue?: string
  kvlistValue?: unknown
}

/**
 * OTEL log record as received from OTLP protocol
 */
export interface OtlpLogRecord {
  timeUnixNano: string
  observedTimeUnixNano?: string
  severityNumber?: number
  severityText?: string
  body?: OtlpBody
  attributes?: Array<{ key: string; value: OtlpAttributeValue }>
  traceId?: string
  spanId?: string
  flags?: number
}

/**
 * OTEL resource with attributes
 */
export interface OtlpResource {
  attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: number } }>
}

// ============================================================================
// Severity Mapping
// ============================================================================

/**
 * Maps OTEL severity number (1-24) to log level string.
 *
 * Per OTEL specification:
 * - 1-4: TRACE
 * - 5-8: DEBUG
 * - 9-12: INFO
 * - 13-16: WARN
 * - 17-20: ERROR
 * - 21-24: FATAL
 *
 * @param severityNumber - OTEL severity number (1-24)
 * @returns Log level string: 'trace', 'debug', 'info', 'warn', 'error', or 'fatal'
 */
export function severityNumberToLevel(severityNumber: number): string {
  if (severityNumber >= 21) return 'fatal'
  if (severityNumber >= 17) return 'error'
  if (severityNumber >= 13) return 'warn'
  if (severityNumber >= 9) return 'info'
  if (severityNumber >= 5) return 'debug'
  return 'trace'
}

// ============================================================================
// Attribute Extraction
// ============================================================================

/**
 * Extracts a primitive value from an OTEL attribute value object.
 *
 * @param value - OTEL attribute value object
 * @returns The extracted primitive value
 */
function extractAttributeValue(value: OtlpAttributeValue): unknown {
  if (value.stringValue !== undefined) return value.stringValue
  if (value.intValue !== undefined) return value.intValue
  if (value.doubleValue !== undefined) return value.doubleValue
  if (value.boolValue !== undefined) return value.boolValue
  if (value.arrayValue !== undefined) {
    return value.arrayValue.values.map((v) => {
      if (v.stringValue !== undefined) return v.stringValue
      if (v.intValue !== undefined) return v.intValue
      if (v.doubleValue !== undefined) return v.doubleValue
      if (v.boolValue !== undefined) return v.boolValue
      return null
    })
  }
  if (value.kvlistValue !== undefined) return value.kvlistValue
  return null
}

/**
 * Converts OTEL attributes array to a flat object.
 *
 * @param attributes - Array of OTEL key-value attributes
 * @returns Object with attribute keys and extracted values
 */
function attributesToObject(
  attributes: Array<{ key: string; value: OtlpAttributeValue }>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const attr of attributes) {
    result[attr.key] = extractAttributeValue(attr.value)
  }
  return result
}

/**
 * Extracts a string value from resource attributes by key.
 *
 * @param resource - OTEL resource
 * @param key - Attribute key to find
 * @returns String value or null if not found
 */
function getResourceAttribute(resource: OtlpResource | undefined, key: string): string | null {
  if (!resource?.attributes) return null
  const attr = resource.attributes.find((a) => a.key === key)
  return attr?.value.stringValue ?? null
}

// ============================================================================
// Timestamp Conversion
// ============================================================================

/**
 * Converts nanosecond timestamp string to ISO date string.
 *
 * @param timeUnixNano - Unix timestamp in nanoseconds as string
 * @returns ISO 8601 date string
 */
function nanoToISOString(timeUnixNano: string): string {
  // Convert nanoseconds to milliseconds (divide by 1,000,000)
  const nanos = BigInt(timeUnixNano)
  const millis = Number(nanos / BigInt(1_000_000))
  return new Date(millis).toISOString()
}

// ============================================================================
// ID Generation
// ============================================================================

let idCounter = 0

/**
 * Generates a unique event ID.
 * Uses a combination of timestamp and counter for uniqueness.
 *
 * @returns Unique event ID string
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36)
  const counter = (idCounter++).toString(36).padStart(4, '0')
  const random = Math.random().toString(36).substring(2, 8)
  return `log_${timestamp}_${counter}_${random}`
}

// ============================================================================
// Main Transformer
// ============================================================================

/**
 * Transforms an OTEL log record into a UnifiedEvent.
 *
 * @param log - OTEL log record
 * @param resource - Optional OTEL resource with service metadata
 * @returns Transformed UnifiedEvent
 *
 * @example
 * ```typescript
 * const otelLog = {
 *   timeUnixNano: '1705329045123000000',
 *   severityNumber: 17,
 *   body: { stringValue: 'Database error' },
 *   traceId: '5b8aa5a2d2c872e8321cf37308d69df2',
 * }
 *
 * const resource = {
 *   attributes: [
 *     { key: 'service.name', value: { stringValue: 'my-api' } }
 *   ]
 * }
 *
 * const event = transformOtelLog(otelLog, resource)
 * // event.event_type === 'log'
 * // event.log_level === 'error'
 * // event.service_name === 'my-api'
 * ```
 */
export function transformOtelLog(log: OtlpLogRecord, resource?: OtlpResource): UnifiedEvent {
  // Determine log level - severityText takes precedence, then derive from severityNumber
  let logLevel: string | null = null
  if (log.severityText) {
    logLevel = log.severityText.toLowerCase()
  } else if (log.severityNumber !== undefined) {
    logLevel = severityNumberToLevel(log.severityNumber)
  }

  // Extract log message from body
  let logMessage: string | null = null
  let data: Record<string, unknown> | null = null

  if (log.body) {
    if (log.body.stringValue !== undefined) {
      logMessage = log.body.stringValue
    } else if (log.body.kvlistValue !== undefined) {
      // Structured body - stringify for log_message, store in data
      logMessage = JSON.stringify(log.body.kvlistValue)
      data = { body: log.body.kvlistValue }
    }
  }

  // Convert attributes array to object
  let attributes: Record<string, unknown> | null = null
  if (log.attributes !== undefined) {
    attributes = attributesToObject(log.attributes)
  }

  // Extract service info from resource
  const serviceName = getResourceAttribute(resource, 'service.name')
  const serviceVersion = getResourceAttribute(resource, 'service.version')

  // Handle empty trace/span IDs as null
  const traceId = log.traceId && log.traceId.length > 0 ? log.traceId : null
  const spanId = log.spanId && log.spanId.length > 0 ? log.spanId : null

  // Determine namespace from service name or use default
  const logNs = serviceName ? `otel.logs.${serviceName}` : 'otel.logs'

  return createUnifiedEvent({
    // Core Identity
    id: generateEventId(),
    event_type: 'log',
    event_name: 'otel.log',
    ns: logNs,

    // Timing
    timestamp: nanoToISOString(log.timeUnixNano),
    timestamp_ns: BigInt(log.timeUnixNano),

    // Logging
    log_level: logLevel,
    log_level_num: log.severityNumber ?? null,
    log_message: logMessage,

    // Trace context (for correlation)
    trace_id: traceId,
    span_id: spanId,

    // Service info
    service_name: serviceName,
    service_version: serviceVersion,

    // Flexible payloads
    attributes,
    data,

    // Event source
    event_source: 'otel',
  })
}
