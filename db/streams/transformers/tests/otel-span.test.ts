/**
 * OTEL Span Transformer Tests
 *
 * Tests for transforming OpenTelemetry spans to the unified event schema.
 * Following TDD: RED phase - these tests define the expected behavior.
 */

import { describe, expect, it } from 'vitest'
import { transformOtelSpan, SpanKind, StatusCode } from '../otel-span'
import type { OtlpSpan, OtlpResource } from '../otel-span'

describe('transformOtelSpan', () => {
  // Helper to create a minimal valid span
  function createMinimalSpan(overrides: Partial<OtlpSpan> = {}): OtlpSpan {
    return {
      traceId: 'abcd1234abcd1234abcd1234abcd1234',
      spanId: '1234567890abcdef',
      name: 'test-span',
      kind: SpanKind.INTERNAL,
      startTimeUnixNano: '1704067200000000000', // 2024-01-01T00:00:00Z
      endTimeUnixNano: '1704067200100000000', // +100ms
      ...overrides,
    }
  }

  // Helper to create a minimal resource
  function createMinimalResource(
    serviceName: string = 'test-service'
  ): OtlpResource {
    return {
      attributes: [
        { key: 'service.name', value: { stringValue: serviceName } },
      ],
    }
  }

  describe('trace ID mapping', () => {
    it('maps traceId to trace_id as hex string', () => {
      const span = createMinimalSpan({
        traceId: 'abcd1234abcd1234abcd1234abcd1234',
      })
      const result = transformOtelSpan(span)

      expect(result.trace_id).toBe('abcd1234abcd1234abcd1234abcd1234')
    })

    it('preserves trace_id as lowercase hex', () => {
      const span = createMinimalSpan({
        traceId: 'ABCD1234ABCD1234ABCD1234ABCD1234',
      })
      const result = transformOtelSpan(span)

      expect(result.trace_id).toBe('abcd1234abcd1234abcd1234abcd1234')
    })
  })

  describe('span ID mapping', () => {
    it('maps spanId to span_id', () => {
      const span = createMinimalSpan({
        spanId: 'deadbeef12345678',
      })
      const result = transformOtelSpan(span)

      expect(result.span_id).toBe('deadbeef12345678')
    })

    it('preserves span_id as lowercase hex', () => {
      const span = createMinimalSpan({
        spanId: 'DEADBEEF12345678',
      })
      const result = transformOtelSpan(span)

      expect(result.span_id).toBe('deadbeef12345678')
    })
  })

  describe('parent span ID mapping', () => {
    it('maps parentSpanId to parent_id', () => {
      const span = createMinimalSpan({
        parentSpanId: 'cafebabe87654321',
      })
      const result = transformOtelSpan(span)

      expect(result.parent_id).toBe('cafebabe87654321')
    })

    it('sets parent_id to null when parentSpanId is undefined', () => {
      const span = createMinimalSpan()
      delete span.parentSpanId
      const result = transformOtelSpan(span)

      expect(result.parent_id).toBeNull()
    })

    it('sets parent_id to null when parentSpanId is empty', () => {
      const span = createMinimalSpan({
        parentSpanId: '',
      })
      const result = transformOtelSpan(span)

      expect(result.parent_id).toBeNull()
    })
  })

  describe('name mapping', () => {
    it('maps name to event_name', () => {
      const span = createMinimalSpan({
        name: 'HTTP GET /api/users',
      })
      const result = transformOtelSpan(span)

      expect(result.event_name).toBe('HTTP GET /api/users')
    })
  })

  describe('span kind mapping', () => {
    it('maps kind INTERNAL (1) correctly', () => {
      const span = createMinimalSpan({ kind: SpanKind.INTERNAL })
      const result = transformOtelSpan(span)

      expect(result.rpc_system).toBeNull() // INTERNAL has no rpc_system
    })

    it('maps kind SERVER (2) correctly', () => {
      const span = createMinimalSpan({ kind: SpanKind.SERVER })
      const result = transformOtelSpan(span)

      expect(result.rpc_system).toBe('server')
    })

    it('maps kind CLIENT (3) correctly', () => {
      const span = createMinimalSpan({ kind: SpanKind.CLIENT })
      const result = transformOtelSpan(span)

      expect(result.rpc_system).toBe('client')
    })

    it('maps kind PRODUCER (4) correctly', () => {
      const span = createMinimalSpan({ kind: SpanKind.PRODUCER })
      const result = transformOtelSpan(span)

      expect(result.msg_operation).toBe('publish')
    })

    it('maps kind CONSUMER (5) correctly', () => {
      const span = createMinimalSpan({ kind: SpanKind.CONSUMER })
      const result = transformOtelSpan(span)

      expect(result.msg_operation).toBe('consume')
    })

    it('handles UNSPECIFIED (0) kind', () => {
      const span = createMinimalSpan({ kind: SpanKind.UNSPECIFIED })
      const result = transformOtelSpan(span)

      expect(result.rpc_system).toBeNull()
      expect(result.msg_operation).toBeNull()
    })
  })

  describe('timing mapping', () => {
    it('maps startTimeUnixNano to started_at ISO string', () => {
      const span = createMinimalSpan({
        startTimeUnixNano: '1704067200000000000', // 2024-01-01T00:00:00Z in nanoseconds
      })
      const result = transformOtelSpan(span)

      expect(result.started_at).toBe('2024-01-01T00:00:00.000Z')
    })

    it('maps startTimeUnixNano to timestamp_ns as bigint', () => {
      const span = createMinimalSpan({
        startTimeUnixNano: '1704067200123456789',
      })
      const result = transformOtelSpan(span)

      expect(result.timestamp_ns).toBe(BigInt('1704067200123456789'))
    })

    it('maps endTimeUnixNano to ended_at ISO string', () => {
      const span = createMinimalSpan({
        endTimeUnixNano: '1704067200500000000', // 2024-01-01T00:00:00.500Z
      })
      const result = transformOtelSpan(span)

      expect(result.ended_at).toBe('2024-01-01T00:00:00.500Z')
    })

    it('calculates duration_ms from start and end times', () => {
      const span = createMinimalSpan({
        startTimeUnixNano: '1704067200000000000',
        endTimeUnixNano: '1704067200150000000', // 150ms later
      })
      const result = transformOtelSpan(span)

      expect(result.duration_ms).toBe(150)
    })

    it('handles sub-millisecond durations', () => {
      const span = createMinimalSpan({
        startTimeUnixNano: '1704067200000000000',
        endTimeUnixNano: '1704067200000500000', // 0.5ms later
      })
      const result = transformOtelSpan(span)

      expect(result.duration_ms).toBeCloseTo(0.5, 1)
    })

    it('preserves nanosecond precision in timestamp', () => {
      const span = createMinimalSpan({
        startTimeUnixNano: '1704067200123456789',
      })
      const result = transformOtelSpan(span)

      // started_at should include milliseconds
      expect(result.started_at).toBe('2024-01-01T00:00:00.123Z')
      // timestamp_ns should have full precision
      expect(result.timestamp_ns).toBe(BigInt('1704067200123456789'))
    })
  })

  describe('status mapping', () => {
    it('maps status.code UNSET (0) to status_code 0', () => {
      const span = createMinimalSpan({
        status: { code: StatusCode.UNSET },
      })
      const result = transformOtelSpan(span)

      expect(result.status_code).toBe(0)
    })

    it('maps status.code OK (1) to status_code 1', () => {
      const span = createMinimalSpan({
        status: { code: StatusCode.OK },
      })
      const result = transformOtelSpan(span)

      expect(result.status_code).toBe(1)
    })

    it('maps status.code ERROR (2) to status_code 2', () => {
      const span = createMinimalSpan({
        status: { code: StatusCode.ERROR, message: 'Something went wrong' },
      })
      const result = transformOtelSpan(span)

      expect(result.status_code).toBe(2)
      expect(result.error_message).toBe('Something went wrong')
    })

    it('maps outcome based on status code', () => {
      const okSpan = createMinimalSpan({ status: { code: StatusCode.OK } })
      const errorSpan = createMinimalSpan({
        status: { code: StatusCode.ERROR },
      })

      expect(transformOtelSpan(okSpan).outcome).toBe('success')
      expect(transformOtelSpan(errorSpan).outcome).toBe('error')
    })

    it('handles missing status', () => {
      const span = createMinimalSpan()
      delete span.status
      const result = transformOtelSpan(span)

      expect(result.status_code).toBeNull()
      expect(result.outcome).toBeNull()
    })
  })

  describe('attributes mapping', () => {
    it('maps attributes array to attributes JSON object', () => {
      const span = createMinimalSpan({
        attributes: [
          { key: 'http.method', value: { stringValue: 'GET' } },
          { key: 'http.status_code', value: { intValue: '200' } },
          { key: 'http.success', value: { boolValue: true } },
        ],
      })
      const result = transformOtelSpan(span)

      expect(result.attributes).toEqual({
        'http.method': 'GET',
        'http.status_code': 200,
        'http.success': true,
      })
    })

    it('handles double values in attributes', () => {
      const span = createMinimalSpan({
        attributes: [
          { key: 'http.duration', value: { doubleValue: 123.456 } },
        ],
      })
      const result = transformOtelSpan(span)

      expect(result.attributes).toEqual({
        'http.duration': 123.456,
      })
    })

    it('handles array values in attributes', () => {
      const span = createMinimalSpan({
        attributes: [
          {
            key: 'http.tags',
            value: {
              arrayValue: {
                values: [{ stringValue: 'tag1' }, { stringValue: 'tag2' }],
              },
            },
          },
        ],
      })
      const result = transformOtelSpan(span)

      expect(result.attributes).toEqual({
        'http.tags': ['tag1', 'tag2'],
      })
    })

    it('returns null for empty attributes', () => {
      const span = createMinimalSpan({ attributes: [] })
      const result = transformOtelSpan(span)

      expect(result.attributes).toBeNull()
    })

    it('returns null for missing attributes', () => {
      const span = createMinimalSpan()
      delete span.attributes
      const result = transformOtelSpan(span)

      expect(result.attributes).toBeNull()
    })

    it('extracts known semantic convention attributes to dedicated fields', () => {
      const span = createMinimalSpan({
        attributes: [
          { key: 'http.method', value: { stringValue: 'POST' } },
          { key: 'http.url', value: { stringValue: 'https://api.example.com/users' } },
          { key: 'http.status_code', value: { intValue: '201' } },
          { key: 'http.host', value: { stringValue: 'api.example.com' } },
        ],
      })
      const result = transformOtelSpan(span)

      expect(result.http_method).toBe('POST')
      expect(result.http_url).toBe('https://api.example.com/users')
      expect(result.http_status).toBe(201)
      expect(result.http_host).toBe('api.example.com')
    })
  })

  describe('resource mapping', () => {
    it('maps resource.service.name to service_name', () => {
      const span = createMinimalSpan()
      const resource = createMinimalResource('my-api-service')
      const result = transformOtelSpan(span, resource)

      expect(result.service_name).toBe('my-api-service')
    })

    it('maps resource.service.version to service_version', () => {
      const span = createMinimalSpan()
      const resource: OtlpResource = {
        attributes: [
          { key: 'service.name', value: { stringValue: 'my-service' } },
          { key: 'service.version', value: { stringValue: '1.2.3' } },
        ],
      }
      const result = transformOtelSpan(span, resource)

      expect(result.service_version).toBe('1.2.3')
    })

    it('maps resource.service.instance.id to service_instance', () => {
      const span = createMinimalSpan()
      const resource: OtlpResource = {
        attributes: [
          { key: 'service.name', value: { stringValue: 'my-service' } },
          { key: 'service.instance.id', value: { stringValue: 'instance-123' } },
        ],
      }
      const result = transformOtelSpan(span, resource)

      expect(result.service_instance).toBe('instance-123')
    })

    it('maps resource.host.name to host_name', () => {
      const span = createMinimalSpan()
      const resource: OtlpResource = {
        attributes: [
          { key: 'service.name', value: { stringValue: 'my-service' } },
          { key: 'host.name', value: { stringValue: 'worker-node-1' } },
        ],
      }
      const result = transformOtelSpan(span, resource)

      expect(result.host_name).toBe('worker-node-1')
    })

    it('handles missing resource', () => {
      const span = createMinimalSpan()
      const result = transformOtelSpan(span)

      expect(result.service_name).toBeNull()
    })
  })

  describe('unified event schema compliance', () => {
    it('sets event_type to trace', () => {
      const span = createMinimalSpan()
      const result = transformOtelSpan(span)

      expect(result.event_type).toBe('trace')
    })

    it('generates a unique id', () => {
      const span = createMinimalSpan()
      const result = transformOtelSpan(span)

      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
      expect(result.id.length).toBeGreaterThan(0)
    })

    it('sets ns from resource or default', () => {
      const span = createMinimalSpan()
      const resource: OtlpResource = {
        attributes: [
          { key: 'service.name', value: { stringValue: 'my-service' } },
          {
            key: 'service.namespace',
            value: { stringValue: 'production' },
          },
        ],
      }
      const result = transformOtelSpan(span, resource)

      expect(result.ns).toBe('production')
    })

    it('uses default ns when not in resource', () => {
      const span = createMinimalSpan()
      const result = transformOtelSpan(span)

      expect(result.ns).toBe('otel')
    })

    it('derives partition columns', () => {
      const span = createMinimalSpan({
        startTimeUnixNano: '1704067200000000000', // 2024-01-01T00:00:00Z
      })
      const result = transformOtelSpan(span)

      expect(result.hour).toBe(0)
      expect(result.day).toBe('2024-01-01')
    })
  })

  describe('edge cases', () => {
    it('handles very large nanosecond timestamps', () => {
      const span = createMinimalSpan({
        startTimeUnixNano: '1893456000000000000', // 2030-01-01T00:00:00Z
        endTimeUnixNano: '1893456001000000000',
      })
      const result = transformOtelSpan(span)

      expect(result.started_at).toBe('2030-01-01T00:00:00.000Z')
      expect(result.duration_ms).toBe(1000)
    })

    it('handles zero duration spans', () => {
      const span = createMinimalSpan({
        startTimeUnixNano: '1704067200000000000',
        endTimeUnixNano: '1704067200000000000',
      })
      const result = transformOtelSpan(span)

      expect(result.duration_ms).toBe(0)
    })
  })
})
