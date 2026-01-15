/**
 * OTEL Metric Transformer
 *
 * Transforms OpenTelemetry metrics to the UnifiedEvent schema.
 *
 * OpenTelemetry Metric Types:
 * - Gauge: Point-in-time measurement (CPU usage, memory)
 * - Sum/Counter: Cumulative or delta values (request count)
 * - Histogram: Distribution of values with buckets
 * - Summary: Pre-calculated quantiles
 *
 * Each metric can have multiple dataPoints, each producing one UnifiedEvent.
 */

import { createUnifiedEvent, type UnifiedEvent } from '../../../types/unified-event'

// ============================================================================
// OTLP Input Types
// ============================================================================

export interface OtlpAttribute {
  key: string
  value: {
    stringValue?: string
    intValue?: string
    doubleValue?: number
    boolValue?: boolean
    arrayValue?: { values: unknown[] }
    kvlistValue?: { values: OtlpAttribute[] }
  }
}

export interface OtlpResource {
  attributes?: OtlpAttribute[]
}

export interface DataPoint {
  attributes?: OtlpAttribute[]
  startTimeUnixNano?: string
  timeUnixNano: string
  asInt?: string
  asDouble?: number
}

export interface HistogramDataPoint {
  attributes?: OtlpAttribute[]
  startTimeUnixNano?: string
  timeUnixNano: string
  count: string
  sum?: number
  min?: number
  max?: number
  bucketCounts: string[]
  explicitBounds: number[]
}

export interface SummaryDataPoint {
  attributes?: OtlpAttribute[]
  startTimeUnixNano?: string
  timeUnixNano: string
  count: string
  sum?: number
  quantileValues: Array<{
    quantile: number
    value: number
  }>
}

export interface OtlpMetric {
  name: string
  description?: string
  unit?: string
  gauge?: { dataPoints: DataPoint[] }
  sum?: {
    dataPoints: DataPoint[]
    isMonotonic?: boolean
    aggregationTemporality?: number
  }
  histogram?: { dataPoints: HistogramDataPoint[] }
  summary?: { dataPoints: SummaryDataPoint[] }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique ID for each event
 */
function generateId(): string {
  return `otel-metric-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Convert nanosecond timestamp to ISO string
 */
function nanoToIso(nanoTimestamp: string): string {
  const millis = BigInt(nanoTimestamp) / BigInt(1000000)
  return new Date(Number(millis)).toISOString()
}

/**
 * Extract attribute value as a string
 */
function extractAttributeValue(value: OtlpAttribute['value']): string {
  if (value.stringValue !== undefined) return value.stringValue
  if (value.intValue !== undefined) return value.intValue
  if (value.doubleValue !== undefined) return String(value.doubleValue)
  if (value.boolValue !== undefined) return String(value.boolValue)
  if (value.arrayValue !== undefined) return JSON.stringify(value.arrayValue.values)
  if (value.kvlistValue !== undefined) return JSON.stringify(value.kvlistValue.values)
  return ''
}

/**
 * Convert OTLP attributes to a labels record
 */
function attributesToLabels(attributes?: OtlpAttribute[]): Record<string, string> | null {
  if (!attributes || attributes.length === 0) return null

  const labels: Record<string, string> = {}
  for (const attr of attributes) {
    labels[attr.key] = extractAttributeValue(attr.value)
  }
  return labels
}

/**
 * Extract value from a datapoint (prefers asDouble for precision)
 */
function extractValue(point: DataPoint): number | null {
  if (point.asDouble !== undefined) return point.asDouble
  if (point.asInt !== undefined) return Number(point.asInt)
  return null
}

/**
 * Extract resource attributes into service/host/cloud fields
 */
interface ResourceFields {
  service_name: string | null
  service_version: string | null
  service_instance: string | null
  service_namespace: string | null
  host_name: string | null
  host_id: string | null
  cloud_provider: string | null
  cloud_region: string | null
  cloud_zone: string | null
  container_id: string | null
  k8s_namespace: string | null
  k8s_pod: string | null
  k8s_deployment: string | null
}

function extractResourceFields(resource?: OtlpResource): ResourceFields {
  const fields: ResourceFields = {
    service_name: null,
    service_version: null,
    service_instance: null,
    service_namespace: null,
    host_name: null,
    host_id: null,
    cloud_provider: null,
    cloud_region: null,
    cloud_zone: null,
    container_id: null,
    k8s_namespace: null,
    k8s_pod: null,
    k8s_deployment: null,
  }

  if (!resource?.attributes) return fields

  for (const attr of resource.attributes) {
    const value = extractAttributeValue(attr.value)
    switch (attr.key) {
      case 'service.name':
        fields.service_name = value
        break
      case 'service.version':
        fields.service_version = value
        break
      case 'service.instance.id':
        fields.service_instance = value
        break
      case 'service.namespace':
        fields.service_namespace = value
        break
      case 'host.name':
        fields.host_name = value
        break
      case 'host.id':
        fields.host_id = value
        break
      case 'cloud.provider':
        fields.cloud_provider = value
        break
      case 'cloud.region':
        fields.cloud_region = value
        break
      case 'cloud.zone':
        fields.cloud_zone = value
        break
      case 'container.id':
        fields.container_id = value
        break
      case 'k8s.namespace.name':
        fields.k8s_namespace = value
        break
      case 'k8s.pod.name':
        fields.k8s_pod = value
        break
      case 'k8s.deployment.name':
        fields.k8s_deployment = value
        break
    }
  }

  return fields
}

// ============================================================================
// Main Transform Function
// ============================================================================

/**
 * Transform an OTLP metric to UnifiedEvent(s).
 *
 * One metric can produce multiple UnifiedEvents (one per datapoint).
 *
 * @param metric - The OTLP metric to transform
 * @param resource - Optional OTLP resource with service/host attributes
 * @returns Array of UnifiedEvents (one per datapoint)
 */
export function transformOtelMetric(
  metric: OtlpMetric,
  resource?: OtlpResource
): UnifiedEvent[] {
  const events: UnifiedEvent[] = []
  const resourceFields = extractResourceFields(resource)

  // Build attributes with description if present
  const metricAttributes: Record<string, unknown> = {}
  if (metric.description) {
    metricAttributes.description = metric.description
  }

  // Determine namespace from resource or default (must be valid topic name)
  const ns = resourceFields.service_name
    ? `otel.metrics.${resourceFields.service_name}`
    : 'otel.metrics'

  // Process gauge metrics
  if (metric.gauge?.dataPoints) {
    for (const point of metric.gauge.dataPoints) {
      events.push(
        createUnifiedEvent({
          id: generateId(),
          event_type: 'metric',
          event_name: metric.name,
          ns,

          // Timing
          timestamp: nanoToIso(point.timeUnixNano),
          timestamp_ns: BigInt(point.timeUnixNano),
          started_at: point.startTimeUnixNano
            ? nanoToIso(point.startTimeUnixNano)
            : null,

          // Metric fields
          metric_name: metric.name,
          metric_unit: metric.unit ?? null,
          metric_type: 'gauge',
          metric_value: extractValue(point),

          // Labels from datapoint attributes
          labels: attributesToLabels(point.attributes),

          // Attributes with description
          attributes: Object.keys(metricAttributes).length > 0 ? metricAttributes : null,

          // Resource fields
          ...resourceFields,
        })
      )
    }
  }

  // Process sum/counter metrics
  if (metric.sum?.dataPoints) {
    // Monotonic sums are counters, non-monotonic are effectively gauges
    const metricType = metric.sum.isMonotonic ? 'counter' : 'gauge'

    for (const point of metric.sum.dataPoints) {
      events.push(
        createUnifiedEvent({
          id: generateId(),
          event_type: 'metric',
          event_name: metric.name,
          ns,

          // Timing
          timestamp: nanoToIso(point.timeUnixNano),
          timestamp_ns: BigInt(point.timeUnixNano),
          started_at: point.startTimeUnixNano
            ? nanoToIso(point.startTimeUnixNano)
            : null,

          // Metric fields
          metric_name: metric.name,
          metric_unit: metric.unit ?? null,
          metric_type: metricType,
          metric_value: extractValue(point),

          // Labels from datapoint attributes
          labels: attributesToLabels(point.attributes),

          // Attributes with description
          attributes: Object.keys(metricAttributes).length > 0 ? metricAttributes : null,

          // Resource fields
          ...resourceFields,
        })
      )
    }
  }

  // Process histogram metrics
  if (metric.histogram?.dataPoints) {
    for (const point of metric.histogram.dataPoints) {
      // Serialize bucket data
      const buckets = {
        bounds: point.explicitBounds,
        counts: point.bucketCounts.map(Number),
      }

      events.push(
        createUnifiedEvent({
          id: generateId(),
          event_type: 'metric',
          event_name: metric.name,
          ns,

          // Timing
          timestamp: nanoToIso(point.timeUnixNano),
          timestamp_ns: BigInt(point.timeUnixNano),
          started_at: point.startTimeUnixNano
            ? nanoToIso(point.startTimeUnixNano)
            : null,

          // Metric fields
          metric_name: metric.name,
          metric_unit: metric.unit ?? null,
          metric_type: 'histogram',
          metric_count: Number(point.count),
          metric_sum: point.sum ?? null,
          metric_min: point.min ?? null,
          metric_max: point.max ?? null,
          metric_buckets: JSON.stringify(buckets),

          // Labels from datapoint attributes
          labels: attributesToLabels(point.attributes),

          // Attributes with description
          attributes: Object.keys(metricAttributes).length > 0 ? metricAttributes : null,

          // Resource fields
          ...resourceFields,
        })
      )
    }
  }

  // Process summary metrics
  if (metric.summary?.dataPoints) {
    for (const point of metric.summary.dataPoints) {
      events.push(
        createUnifiedEvent({
          id: generateId(),
          event_type: 'metric',
          event_name: metric.name,
          ns,

          // Timing
          timestamp: nanoToIso(point.timeUnixNano),
          timestamp_ns: BigInt(point.timeUnixNano),
          started_at: point.startTimeUnixNano
            ? nanoToIso(point.startTimeUnixNano)
            : null,

          // Metric fields
          metric_name: metric.name,
          metric_unit: metric.unit ?? null,
          metric_type: 'summary',
          metric_count: Number(point.count),
          metric_sum: point.sum ?? null,
          metric_quantiles: JSON.stringify(point.quantileValues),

          // Labels from datapoint attributes
          labels: attributesToLabels(point.attributes),

          // Attributes with description
          attributes: Object.keys(metricAttributes).length > 0 ? metricAttributes : null,

          // Resource fields
          ...resourceFields,
        })
      )
    }
  }

  return events
}
