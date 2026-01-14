import { describe, it, expect, beforeAll } from 'vitest'
import type { UnifiedEvent } from '../../../../types/unified-event'

/**
 * OTEL Metric Transformer Tests
 *
 * Tests for transforming OpenTelemetry metrics to UnifiedEvent schema.
 *
 * RED Phase TDD - tests should FAIL until the transformer is implemented
 * in db/streams/transformers/otel-metric.ts
 *
 * OpenTelemetry Metric Types:
 * - Gauge: Point-in-time measurement (CPU usage, memory)
 * - Sum/Counter: Cumulative or delta values (request count)
 * - Histogram: Distribution of values with buckets
 * - Summary: Pre-calculated quantiles
 *
 * Each metric can have multiple dataPoints, each producing one UnifiedEvent.
 */

// ============================================================================
// OTLP Metric Types (Expected Input Interface)
// ============================================================================

interface OtlpAttribute {
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

interface OtlpResource {
  attributes?: OtlpAttribute[]
}

interface DataPoint {
  attributes?: OtlpAttribute[]
  startTimeUnixNano?: string
  timeUnixNano: string
  asInt?: string
  asDouble?: number
}

interface HistogramDataPoint {
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

interface SummaryDataPoint {
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

interface OtlpMetric {
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
// Dynamic Import for RED Phase TDD
// ============================================================================

let transformOtelMetric:
  | ((metric: OtlpMetric, resource?: OtlpResource) => UnifiedEvent[])
  | undefined

beforeAll(async () => {
  try {
    const module = await import('../otel-metric')
    transformOtelMetric = module.transformOtelMetric
  } catch {
    // Module doesn't exist yet - this is expected in RED phase
  }
})

// ============================================================================
// Basic Field Mapping Tests
// ============================================================================

describe('OTEL Metric Transformer', () => {
  describe('Export', () => {
    it('transformOtelMetric function is exported', () => {
      expect(
        transformOtelMetric,
        'transformOtelMetric should be exported from db/streams/transformers/otel-metric.ts'
      ).toBeDefined()
      expect(typeof transformOtelMetric).toBe('function')
    })
  })

  describe('Basic Field Mapping', () => {
    it('maps name to metric_name', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asDouble: 100 }],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBeGreaterThan(0)
      expect(events[0].metric_name).toBe('http.server.request_duration')
    })

    it('maps description to attributes', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'system.cpu.utilization',
        description: 'CPU utilization as a percentage',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asDouble: 0.75 }],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBeGreaterThan(0)
      // Description should be preserved in attributes
      expect(events[0].attributes).toBeDefined()
      expect((events[0].attributes as Record<string, unknown>).description).toBe(
        'CPU utilization as a percentage'
      )
    })

    it('maps unit to metric_unit', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        unit: 'ms',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asDouble: 150 }],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBeGreaterThan(0)
      expect(events[0].metric_unit).toBe('ms')
    })
  })

  // ============================================================================
  // Gauge Metric Tests
  // ============================================================================

  describe('Gauge Metrics', () => {
    it('handles gauge metrics with metric_type=gauge', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'system.memory.usage',
        unit: 'bytes',
        gauge: {
          dataPoints: [
            { timeUnixNano: '1705329045000000000', asInt: '1073741824' },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBe(1)
      expect(events[0].metric_type).toBe('gauge')
    })

    it('extracts gauge value from asInt', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'process.threads',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asInt: '42' }],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].metric_value).toBe(42)
    })

    it('extracts gauge value from asDouble', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'system.cpu.utilization',
        gauge: {
          dataPoints: [
            { timeUnixNano: '1705329045000000000', asDouble: 0.7532 },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].metric_value).toBe(0.7532)
    })
  })

  // ============================================================================
  // Sum/Counter Metric Tests
  // ============================================================================

  describe('Sum/Counter Metrics', () => {
    it('handles sum metrics with metric_type=counter for monotonic sums', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_count',
        sum: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asInt: '1000' }],
          isMonotonic: true,
          aggregationTemporality: 2, // CUMULATIVE
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBe(1)
      expect(events[0].metric_type).toBe('counter')
    })

    it('handles sum metrics with metric_type=gauge for non-monotonic sums', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'system.network.connections',
        sum: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asInt: '50' }],
          isMonotonic: false,
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBe(1)
      // Non-monotonic sums are effectively gauges
      expect(events[0].metric_type).toBe('gauge')
    })

    it('extracts counter value from sum dataPoints', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_count',
        sum: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asInt: '5000' }],
          isMonotonic: true,
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].metric_value).toBe(5000)
    })
  })

  // ============================================================================
  // Histogram Metric Tests
  // ============================================================================

  describe('Histogram Metrics', () => {
    it('handles histogram metrics with metric_type=histogram', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        unit: 'ms',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              count: '100',
              sum: 15000,
              min: 10,
              max: 500,
              bucketCounts: ['10', '30', '40', '15', '5'],
              explicitBounds: [50, 100, 200, 500],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBe(1)
      expect(events[0].metric_type).toBe('histogram')
    })

    it('extracts histogram count to metric_count', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              count: '500',
              bucketCounts: ['100', '200', '150', '50'],
              explicitBounds: [10, 50, 100],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].metric_count).toBe(500)
    })

    it('extracts histogram sum to metric_sum', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              count: '100',
              sum: 25000.5,
              bucketCounts: ['50', '30', '20'],
              explicitBounds: [100, 500],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].metric_sum).toBe(25000.5)
    })

    it('extracts histogram min/max to metric_min/metric_max', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              count: '100',
              min: 5,
              max: 1200,
              bucketCounts: ['50', '30', '20'],
              explicitBounds: [100, 500],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].metric_min).toBe(5)
      expect(events[0].metric_max).toBe(1200)
    })

    it('serializes histogram buckets to metric_buckets JSON', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              count: '100',
              bucketCounts: ['10', '30', '40', '20'],
              explicitBounds: [50, 100, 200],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].metric_buckets).toBeDefined()

      const buckets = JSON.parse(events[0].metric_buckets!)
      expect(buckets).toEqual({
        bounds: [50, 100, 200],
        counts: [10, 30, 40, 20],
      })
    })
  })

  // ============================================================================
  // Summary Metric Tests
  // ============================================================================

  describe('Summary Metrics', () => {
    it('handles summary metrics with metric_type=summary', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'rpc.server.duration',
        summary: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              count: '1000',
              sum: 50000,
              quantileValues: [
                { quantile: 0.5, value: 45 },
                { quantile: 0.9, value: 120 },
                { quantile: 0.99, value: 300 },
              ],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBe(1)
      expect(events[0].metric_type).toBe('summary')
    })

    it('extracts summary count and sum', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'rpc.server.duration',
        summary: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              count: '2500',
              sum: 125000,
              quantileValues: [{ quantile: 0.5, value: 50 }],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].metric_count).toBe(2500)
      expect(events[0].metric_sum).toBe(125000)
    })

    it('serializes summary quantiles to metric_quantiles JSON', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'rpc.server.duration',
        summary: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              count: '1000',
              quantileValues: [
                { quantile: 0.5, value: 45 },
                { quantile: 0.9, value: 120 },
                { quantile: 0.95, value: 200 },
                { quantile: 0.99, value: 350 },
              ],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].metric_quantiles).toBeDefined()

      const quantiles = JSON.parse(events[0].metric_quantiles!)
      expect(quantiles).toEqual([
        { quantile: 0.5, value: 45 },
        { quantile: 0.9, value: 120 },
        { quantile: 0.95, value: 200 },
        { quantile: 0.99, value: 350 },
      ])
    })
  })

  // ============================================================================
  // DataPoint Flattening Tests
  // ============================================================================

  describe('DataPoint Flattening', () => {
    it('flattens multiple dataPoints to multiple events', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'system.cpu.utilization',
        gauge: {
          dataPoints: [
            { timeUnixNano: '1705329045000000000', asDouble: 0.5 },
            { timeUnixNano: '1705329046000000000', asDouble: 0.6 },
            { timeUnixNano: '1705329047000000000', asDouble: 0.55 },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBe(3)
      expect(events[0].metric_value).toBe(0.5)
      expect(events[1].metric_value).toBe(0.6)
      expect(events[2].metric_value).toBe(0.55)
    })

    it('each event has unique timestamp from dataPoint', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.active_requests',
        gauge: {
          dataPoints: [
            { timeUnixNano: '1705329045000000000', asInt: '10' },
            { timeUnixNano: '1705329060000000000', asInt: '15' },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBe(2)

      // Timestamps should be converted to ISO strings or nanoseconds
      expect(events[0].timestamp_ns).toBe(BigInt('1705329045000000000'))
      expect(events[1].timestamp_ns).toBe(BigInt('1705329060000000000'))
    })

    it('derives ISO timestamp from nanoseconds', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        gauge: {
          dataPoints: [
            // 2024-01-15T14:30:45.123Z in nanoseconds
            { timeUnixNano: '1705329045123000000', asDouble: 1.0 },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].timestamp).toBe('2024-01-15T14:30:45.123Z')
    })
  })

  // ============================================================================
  // DataPoint Attributes (Labels) Tests
  // ============================================================================

  describe('DataPoint Attributes', () => {
    it('preserves dataPoint attributes as labels JSON', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              asDouble: 150,
              attributes: [
                { key: 'http.method', value: { stringValue: 'GET' } },
                { key: 'http.status_code', value: { intValue: '200' } },
                { key: 'http.route', value: { stringValue: '/api/users' } },
              ],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].labels).toBeDefined()
      expect(events[0].labels).toEqual({
        'http.method': 'GET',
        'http.status_code': '200',
        'http.route': '/api/users',
      })
    })

    it('handles different attribute value types', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              asDouble: 1.0,
              attributes: [
                { key: 'string_attr', value: { stringValue: 'hello' } },
                { key: 'int_attr', value: { intValue: '42' } },
                { key: 'double_attr', value: { doubleValue: 3.14 } },
                { key: 'bool_attr', value: { boolValue: true } },
              ],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].labels).toEqual({
        string_attr: 'hello',
        int_attr: '42',
        double_attr: '3.14',
        bool_attr: 'true',
      })
    })

    it('different dataPoints can have different attributes', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              asDouble: 100,
              attributes: [
                { key: 'http.method', value: { stringValue: 'GET' } },
              ],
            },
            {
              timeUnixNano: '1705329046000000000',
              asDouble: 200,
              attributes: [
                { key: 'http.method', value: { stringValue: 'POST' } },
              ],
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events.length).toBe(2)
      expect(events[0].labels).toEqual({ 'http.method': 'GET' })
      expect(events[1].labels).toEqual({ 'http.method': 'POST' })
    })
  })

  // ============================================================================
  // Resource Attributes Tests
  // ============================================================================

  describe('Resource Attributes', () => {
    it('maps resource attributes to service fields', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_count',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asInt: '100' }],
        },
      }

      const resource: OtlpResource = {
        attributes: [
          { key: 'service.name', value: { stringValue: 'api-gateway' } },
          { key: 'service.version', value: { stringValue: '1.2.3' } },
          {
            key: 'service.instance.id',
            value: { stringValue: 'instance-abc' },
          },
          { key: 'service.namespace', value: { stringValue: 'production' } },
        ],
      }

      const events = transformOtelMetric!(metric, resource)
      expect(events[0].service_name).toBe('api-gateway')
      expect(events[0].service_version).toBe('1.2.3')
      expect(events[0].service_instance).toBe('instance-abc')
      expect(events[0].service_namespace).toBe('production')
    })

    it('maps resource host attributes', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'system.memory.usage',
        gauge: {
          dataPoints: [
            { timeUnixNano: '1705329045000000000', asInt: '1073741824' },
          ],
        },
      }

      const resource: OtlpResource = {
        attributes: [
          { key: 'host.name', value: { stringValue: 'worker-node-1' } },
          { key: 'host.id', value: { stringValue: 'host-xyz-123' } },
        ],
      }

      const events = transformOtelMetric!(metric, resource)
      expect(events[0].host_name).toBe('worker-node-1')
      expect(events[0].host_id).toBe('host-xyz-123')
    })

    it('maps resource cloud attributes', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asDouble: 1.0 }],
        },
      }

      const resource: OtlpResource = {
        attributes: [
          { key: 'cloud.provider', value: { stringValue: 'cloudflare' } },
          { key: 'cloud.region', value: { stringValue: 'us-west' } },
        ],
      }

      const events = transformOtelMetric!(metric, resource)
      expect(events[0].cloud_provider).toBe('cloudflare')
      expect(events[0].cloud_region).toBe('us-west')
    })
  })

  // ============================================================================
  // Event Core Identity Tests
  // ============================================================================

  describe('Event Core Identity', () => {
    it('sets event_type to metric', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asDouble: 1.0 }],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].event_type).toBe('metric')
    })

    it('sets event_name from metric name', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asDouble: 100 }],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].event_name).toBe('http.server.request_duration')
    })

    it('generates unique id for each event', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        gauge: {
          dataPoints: [
            { timeUnixNano: '1705329045000000000', asDouble: 1.0 },
            { timeUnixNano: '1705329046000000000', asDouble: 2.0 },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].id).toBeDefined()
      expect(events[1].id).toBeDefined()
      expect(events[0].id).not.toBe(events[1].id)
    })

    it('sets ns (namespace) appropriately', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        gauge: {
          dataPoints: [{ timeUnixNano: '1705329045000000000', asDouble: 1.0 }],
        },
      }

      const events = transformOtelMetric!(metric)
      // ns should be set (could be derived from resource or default)
      expect(events[0].ns).toBeDefined()
      expect(typeof events[0].ns).toBe('string')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles metric with empty dataPoints array', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        gauge: {
          dataPoints: [],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events).toEqual([])
    })

    it('handles metric with no dataPoints property', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        // No gauge, sum, histogram, or summary
      }

      const events = transformOtelMetric!(metric)
      expect(events).toEqual([])
    })

    it('handles dataPoint with both asInt and asDouble (prefers asDouble)', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: '1705329045000000000',
              asInt: '100',
              asDouble: 100.5,
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      // asDouble should take precedence as it's more precise
      expect(events[0].metric_value).toBe(100.5)
    })

    it('handles very large timestamp values', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'test.metric',
        gauge: {
          dataPoints: [
            {
              // Far future timestamp
              timeUnixNano: '2000000000000000000',
              asDouble: 1.0,
            },
          ],
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].timestamp_ns).toBe(BigInt('2000000000000000000'))
    })

    it('handles startTimeUnixNano for delta calculations', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_count',
        sum: {
          dataPoints: [
            {
              startTimeUnixNano: '1705329000000000000',
              timeUnixNano: '1705329045000000000',
              asInt: '100',
            },
          ],
          isMonotonic: true,
          aggregationTemporality: 1, // DELTA
        },
      }

      const events = transformOtelMetric!(metric)
      expect(events[0].started_at).toBe('2024-01-15T14:30:00.000Z')
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('Integration', () => {
    it('produces valid UnifiedEvent with all required fields', () => {
      expect(transformOtelMetric).toBeDefined()

      const metric: OtlpMetric = {
        name: 'http.server.request_duration',
        description: 'Duration of HTTP requests',
        unit: 'ms',
        histogram: {
          dataPoints: [
            {
              timeUnixNano: '1705329045123456789',
              count: '1000',
              sum: 50000,
              min: 5,
              max: 500,
              bucketCounts: ['100', '400', '300', '150', '50'],
              explicitBounds: [10, 50, 100, 250],
              attributes: [
                { key: 'http.method', value: { stringValue: 'GET' } },
                { key: 'http.route', value: { stringValue: '/api/users' } },
              ],
            },
          ],
        },
      }

      const resource: OtlpResource = {
        attributes: [
          { key: 'service.name', value: { stringValue: 'api-gateway' } },
          { key: 'service.version', value: { stringValue: '2.0.0' } },
        ],
      }

      const events = transformOtelMetric!(metric, resource)
      expect(events.length).toBe(1)

      const event = events[0]

      // Core identity
      expect(event.id).toBeDefined()
      expect(event.event_type).toBe('metric')
      expect(event.event_name).toBe('http.server.request_duration')
      expect(event.ns).toBeDefined()

      // Metric fields
      expect(event.metric_name).toBe('http.server.request_duration')
      expect(event.metric_unit).toBe('ms')
      expect(event.metric_type).toBe('histogram')
      expect(event.metric_count).toBe(1000)
      expect(event.metric_sum).toBe(50000)
      expect(event.metric_min).toBe(5)
      expect(event.metric_max).toBe(500)
      expect(event.metric_buckets).toBeDefined()

      // Service fields from resource
      expect(event.service_name).toBe('api-gateway')
      expect(event.service_version).toBe('2.0.0')

      // Labels from dataPoint attributes
      expect(event.labels).toEqual({
        'http.method': 'GET',
        'http.route': '/api/users',
      })

      // Description in attributes
      expect((event.attributes as Record<string, unknown>).description).toBe(
        'Duration of HTTP requests'
      )
    })
  })
})
