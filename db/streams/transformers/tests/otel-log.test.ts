/**
 * OTEL Log Transformer Tests
 *
 * Tests for transforming OpenTelemetry log records into the unified event schema.
 * This is RED phase TDD - tests should FAIL until the transformer is implemented.
 *
 * OTEL Log Record format:
 * - timeUnixNano: string (nanoseconds since epoch)
 * - observedTimeUnixNano: string (optional)
 * - severityNumber: number (1-24)
 * - severityText: string (optional)
 * - body: { stringValue?: string, kvlistValue?: unknown }
 * - attributes: Array<{ key: string, value: unknown }>
 * - traceId: string (hex, for correlation)
 * - spanId: string (hex, for correlation)
 * - flags: number (optional)
 *
 * Severity mapping (OTEL spec):
 * - 1-4: TRACE -> 'trace'
 * - 5-8: DEBUG -> 'debug'
 * - 9-12: INFO -> 'info'
 * - 13-16: WARN -> 'warn'
 * - 17-20: ERROR -> 'error'
 * - 21-24: FATAL -> 'fatal'
 */

import { describe, it, expect, beforeAll } from 'vitest'
import type { UnifiedEvent } from '../../../../types/unified-event'

// ============================================================================
// Types for OTEL Log Records
// ============================================================================

interface OtlpLogRecord {
  timeUnixNano: string
  observedTimeUnixNano?: string
  severityNumber?: number
  severityText?: string
  body?: { stringValue?: string; kvlistValue?: unknown }
  attributes?: Array<{ key: string; value: unknown }>
  traceId?: string
  spanId?: string
  flags?: number
}

interface OtlpResource {
  attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: number } }>
}

// ============================================================================
// Dynamic Import for RED Phase TDD
// ============================================================================

let transformOtelLog: ((log: OtlpLogRecord, resource?: OtlpResource) => UnifiedEvent) | undefined
let severityNumberToLevel: ((severityNumber: number) => string) | undefined

beforeAll(async () => {
  try {
    const module = await import('../otel-log')
    transformOtelLog = module.transformOtelLog
    severityNumberToLevel = module.severityNumberToLevel
  } catch {
    // Module doesn't exist yet - this is expected in RED phase
    // Tests will fail with clear messages about what's missing
  }
})

// ============================================================================
// Transformer Export Tests
// ============================================================================

describe('OTEL Log Transformer Export', () => {
  it('transformOtelLog function is exported', () => {
    expect(transformOtelLog, 'transformOtelLog should be exported from otel-log.ts').toBeDefined()
    expect(typeof transformOtelLog).toBe('function')
  })

  it('severityNumberToLevel function is exported', () => {
    expect(severityNumberToLevel, 'severityNumberToLevel should be exported from otel-log.ts').toBeDefined()
    expect(typeof severityNumberToLevel).toBe('function')
  })
})

// ============================================================================
// Timestamp Mapping Tests
// ============================================================================

describe('Timestamp Mapping', () => {
  describe('timeUnixNano to timestamp and timestamp_ns', () => {
    it('maps timeUnixNano to timestamp as ISO string', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000', // 2024-01-15T14:30:45.123Z
        severityNumber: 9,
        body: { stringValue: 'Test message' },
      }

      const result = transformOtelLog!(log)

      expect(result.timestamp).toBe('2024-01-15T14:30:45.123Z')
    })

    it('maps timeUnixNano to timestamp_ns as bigint', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123456789',
        severityNumber: 9,
        body: { stringValue: 'Test message' },
      }

      const result = transformOtelLog!(log)

      expect(result.timestamp_ns).toBe(BigInt('1705329045123456789'))
    })

    it('handles timestamp at epoch', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '0',
        severityNumber: 9,
        body: { stringValue: 'Epoch test' },
      }

      const result = transformOtelLog!(log)

      expect(result.timestamp).toBe('1970-01-01T00:00:00.000Z')
      expect(result.timestamp_ns).toBe(BigInt(0))
    })

    it('handles large timestamps (year 2100)', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      // 2100-01-01T00:00:00Z in nanoseconds
      const log: OtlpLogRecord = {
        timeUnixNano: '4102444800000000000',
        severityNumber: 9,
        body: { stringValue: 'Future test' },
      }

      const result = transformOtelLog!(log)

      expect(result.timestamp).toBe('2100-01-01T00:00:00.000Z')
      expect(result.timestamp_ns).toBe(BigInt('4102444800000000000'))
    })
  })
})

// ============================================================================
// Severity Number Mapping Tests
// ============================================================================

describe('Severity Number Mapping', () => {
  describe('severityNumber to log_level_num', () => {
    it('maps severityNumber directly to log_level_num', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 17,
        body: { stringValue: 'Error message' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_level_num).toBe(17)
    })

    it('handles severityNumber 1 (TRACE minimum)', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 1,
        body: { stringValue: 'Trace message' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_level_num).toBe(1)
    })

    it('handles severityNumber 24 (FATAL maximum)', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 24,
        body: { stringValue: 'Fatal message' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_level_num).toBe(24)
    })

    it('defaults to null when severityNumber is not provided', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        body: { stringValue: 'No severity' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_level_num).toBeNull()
    })
  })

  describe('severityNumber to log_level string', () => {
    it('maps 1-4 to "trace"', () => {
      expect(severityNumberToLevel, 'severityNumberToLevel must be defined').toBeDefined()

      expect(severityNumberToLevel!(1)).toBe('trace')
      expect(severityNumberToLevel!(2)).toBe('trace')
      expect(severityNumberToLevel!(3)).toBe('trace')
      expect(severityNumberToLevel!(4)).toBe('trace')
    })

    it('maps 5-8 to "debug"', () => {
      expect(severityNumberToLevel, 'severityNumberToLevel must be defined').toBeDefined()

      expect(severityNumberToLevel!(5)).toBe('debug')
      expect(severityNumberToLevel!(6)).toBe('debug')
      expect(severityNumberToLevel!(7)).toBe('debug')
      expect(severityNumberToLevel!(8)).toBe('debug')
    })

    it('maps 9-12 to "info"', () => {
      expect(severityNumberToLevel, 'severityNumberToLevel must be defined').toBeDefined()

      expect(severityNumberToLevel!(9)).toBe('info')
      expect(severityNumberToLevel!(10)).toBe('info')
      expect(severityNumberToLevel!(11)).toBe('info')
      expect(severityNumberToLevel!(12)).toBe('info')
    })

    it('maps 13-16 to "warn"', () => {
      expect(severityNumberToLevel, 'severityNumberToLevel must be defined').toBeDefined()

      expect(severityNumberToLevel!(13)).toBe('warn')
      expect(severityNumberToLevel!(14)).toBe('warn')
      expect(severityNumberToLevel!(15)).toBe('warn')
      expect(severityNumberToLevel!(16)).toBe('warn')
    })

    it('maps 17-20 to "error"', () => {
      expect(severityNumberToLevel, 'severityNumberToLevel must be defined').toBeDefined()

      expect(severityNumberToLevel!(17)).toBe('error')
      expect(severityNumberToLevel!(18)).toBe('error')
      expect(severityNumberToLevel!(19)).toBe('error')
      expect(severityNumberToLevel!(20)).toBe('error')
    })

    it('maps 21-24 to "fatal"', () => {
      expect(severityNumberToLevel, 'severityNumberToLevel must be defined').toBeDefined()

      expect(severityNumberToLevel!(21)).toBe('fatal')
      expect(severityNumberToLevel!(22)).toBe('fatal')
      expect(severityNumberToLevel!(23)).toBe('fatal')
      expect(severityNumberToLevel!(24)).toBe('fatal')
    })

    it('transformer uses severityNumber for log_level', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const testCases = [
        { severityNumber: 1, expectedLevel: 'trace' },
        { severityNumber: 5, expectedLevel: 'debug' },
        { severityNumber: 9, expectedLevel: 'info' },
        { severityNumber: 13, expectedLevel: 'warn' },
        { severityNumber: 17, expectedLevel: 'error' },
        { severityNumber: 21, expectedLevel: 'fatal' },
      ]

      for (const { severityNumber, expectedLevel } of testCases) {
        const log: OtlpLogRecord = {
          timeUnixNano: '1705329045123000000',
          severityNumber,
          body: { stringValue: 'Test' },
        }

        const result = transformOtelLog!(log)
        expect(result.log_level).toBe(expectedLevel)
      }
    })
  })
})

// ============================================================================
// Severity Text Mapping Tests
// ============================================================================

describe('Severity Text Mapping', () => {
  describe('severityText to log_level', () => {
    it('uses severityText when provided (overrides derived level)', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9, // Would derive to 'info'
        severityText: 'WARN', // Explicit text takes precedence
        body: { stringValue: 'Test message' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_level).toBe('warn')
    })

    it('normalizes severityText to lowercase', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const testCases = ['DEBUG', 'Debug', 'debug', 'INFO', 'WARN', 'ERROR', 'FATAL']

      for (const severityText of testCases) {
        const log: OtlpLogRecord = {
          timeUnixNano: '1705329045123000000',
          severityText,
          body: { stringValue: 'Test' },
        }

        const result = transformOtelLog!(log)
        expect(result.log_level).toBe(severityText.toLowerCase())
      }
    })

    it('derives log_level from severityNumber when severityText is not present', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 17,
        body: { stringValue: 'Error without text' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_level).toBe('error')
    })

    it('defaults log_level to null when neither severityText nor severityNumber', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        body: { stringValue: 'No severity info' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_level).toBeNull()
    })
  })
})

// ============================================================================
// Body Mapping Tests
// ============================================================================

describe('Body Mapping', () => {
  describe('string body to log_message', () => {
    it('maps body.stringValue to log_message', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'This is a log message' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_message).toBe('This is a log message')
    })

    it('handles empty string body', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: '' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_message).toBe('')
    })

    it('handles body with special characters', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Message with "quotes" and \n newlines' },
      }

      const result = transformOtelLog!(log)

      expect(result.log_message).toBe('Message with "quotes" and \n newlines')
    })
  })

  describe('structured body to log_message and data', () => {
    it('maps body.kvlistValue to JSON stringified log_message', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: {
          kvlistValue: {
            values: [
              { key: 'user', value: { stringValue: 'alice' } },
              { key: 'action', value: { stringValue: 'login' } },
            ],
          },
        },
      }

      const result = transformOtelLog!(log)

      // log_message should be JSON stringified
      expect(typeof result.log_message).toBe('string')
      expect(result.log_message).toContain('user')
      expect(result.log_message).toContain('alice')
    })

    it('stores structured body in data field', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const structuredBody = {
        values: [
          { key: 'user', value: { stringValue: 'alice' } },
          { key: 'count', value: { intValue: 42 } },
        ],
      }

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { kvlistValue: structuredBody },
      }

      const result = transformOtelLog!(log)

      expect(result.data).toBeDefined()
      expect(result.data).toEqual({ body: structuredBody })
    })

    it('handles missing body gracefully', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
      }

      const result = transformOtelLog!(log)

      expect(result.log_message).toBeNull()
      expect(result.data).toBeNull()
    })
  })
})

// ============================================================================
// Attributes Mapping Tests
// ============================================================================

describe('Attributes Mapping', () => {
  describe('attributes to attributes JSON', () => {
    it('maps OTEL attributes array to attributes object', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
        attributes: [
          { key: 'http.method', value: { stringValue: 'GET' } },
          { key: 'http.status_code', value: { intValue: 200 } },
        ],
      }

      const result = transformOtelLog!(log)

      expect(result.attributes).toBeDefined()
      expect(result.attributes).toEqual({
        'http.method': 'GET',
        'http.status_code': 200,
      })
    })

    it('handles empty attributes array', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
        attributes: [],
      }

      const result = transformOtelLog!(log)

      expect(result.attributes).toEqual({})
    })

    it('handles missing attributes', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
      }

      const result = transformOtelLog!(log)

      expect(result.attributes).toBeNull()
    })

    it('handles various attribute value types', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
        attributes: [
          { key: 'string_attr', value: { stringValue: 'hello' } },
          { key: 'int_attr', value: { intValue: 42 } },
          { key: 'double_attr', value: { doubleValue: 3.14 } },
          { key: 'bool_attr', value: { boolValue: true } },
          {
            key: 'array_attr',
            value: {
              arrayValue: {
                values: [{ stringValue: 'a' }, { stringValue: 'b' }],
              },
            },
          },
        ],
      }

      const result = transformOtelLog!(log)

      expect(result.attributes).toBeDefined()
      expect(result.attributes!['string_attr']).toBe('hello')
      expect(result.attributes!['int_attr']).toBe(42)
      expect(result.attributes!['double_attr']).toBe(3.14)
      expect(result.attributes!['bool_attr']).toBe(true)
      expect(result.attributes!['array_attr']).toEqual(['a', 'b'])
    })
  })
})

// ============================================================================
// Trace Context Mapping Tests
// ============================================================================

describe('Trace Context Mapping', () => {
  describe('traceId mapping', () => {
    it('maps traceId to trace_id', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
        traceId: '5b8aa5a2d2c872e8321cf37308d69df2',
      }

      const result = transformOtelLog!(log)

      expect(result.trace_id).toBe('5b8aa5a2d2c872e8321cf37308d69df2')
    })

    it('handles missing traceId', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
      }

      const result = transformOtelLog!(log)

      expect(result.trace_id).toBeNull()
    })

    it('handles empty string traceId as null', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
        traceId: '',
      }

      const result = transformOtelLog!(log)

      expect(result.trace_id).toBeNull()
    })
  })

  describe('spanId mapping', () => {
    it('maps spanId to span_id', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
        spanId: 'acbdef0123456789',
      }

      const result = transformOtelLog!(log)

      expect(result.span_id).toBe('acbdef0123456789')
    })

    it('handles missing spanId', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
      }

      const result = transformOtelLog!(log)

      expect(result.span_id).toBeNull()
    })

    it('handles empty string spanId as null', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
        spanId: '',
      }

      const result = transformOtelLog!(log)

      expect(result.span_id).toBeNull()
    })
  })

  describe('combined trace context', () => {
    it('maps both traceId and spanId for correlation', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Correlated log' },
        traceId: '5b8aa5a2d2c872e8321cf37308d69df2',
        spanId: 'acbdef0123456789',
      }

      const result = transformOtelLog!(log)

      expect(result.trace_id).toBe('5b8aa5a2d2c872e8321cf37308d69df2')
      expect(result.span_id).toBe('acbdef0123456789')
    })
  })
})

// ============================================================================
// Resource Mapping Tests
// ============================================================================

describe('Resource Mapping', () => {
  describe('resource.service.name to service_name', () => {
    it('maps resource service.name attribute to service_name', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
      }

      const resource: OtlpResource = {
        attributes: [{ key: 'service.name', value: { stringValue: 'my-api-service' } }],
      }

      const result = transformOtelLog!(log, resource)

      expect(result.service_name).toBe('my-api-service')
    })

    it('handles missing resource', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
      }

      const result = transformOtelLog!(log)

      expect(result.service_name).toBeNull()
    })

    it('handles resource without service.name', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
      }

      const resource: OtlpResource = {
        attributes: [{ key: 'deployment.environment', value: { stringValue: 'production' } }],
      }

      const result = transformOtelLog!(log, resource)

      expect(result.service_name).toBeNull()
    })

    it('extracts other resource attributes to attributes', () => {
      expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

      const log: OtlpLogRecord = {
        timeUnixNano: '1705329045123000000',
        severityNumber: 9,
        body: { stringValue: 'Test' },
      }

      const resource: OtlpResource = {
        attributes: [
          { key: 'service.name', value: { stringValue: 'my-service' } },
          { key: 'service.version', value: { stringValue: '1.2.3' } },
          { key: 'deployment.environment', value: { stringValue: 'production' } },
        ],
      }

      const result = transformOtelLog!(log, resource)

      expect(result.service_name).toBe('my-service')
      expect(result.service_version).toBe('1.2.3')
    })
  })
})

// ============================================================================
// Core Identity Fields Tests
// ============================================================================

describe('Core Identity Fields', () => {
  it('generates unique id for each event', () => {
    expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

    const log: OtlpLogRecord = {
      timeUnixNano: '1705329045123000000',
      severityNumber: 9,
      body: { stringValue: 'Test' },
    }

    const result1 = transformOtelLog!(log)
    const result2 = transformOtelLog!(log)

    expect(result1.id).toBeDefined()
    expect(result2.id).toBeDefined()
    expect(result1.id).not.toBe(result2.id)
  })

  it('sets event_type to "log"', () => {
    expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

    const log: OtlpLogRecord = {
      timeUnixNano: '1705329045123000000',
      severityNumber: 9,
      body: { stringValue: 'Test' },
    }

    const result = transformOtelLog!(log)

    expect(result.event_type).toBe('log')
  })

  it('sets event_name to "otel.log"', () => {
    expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

    const log: OtlpLogRecord = {
      timeUnixNano: '1705329045123000000',
      severityNumber: 9,
      body: { stringValue: 'Test' },
    }

    const result = transformOtelLog!(log)

    expect(result.event_name).toBe('otel.log')
  })

  it('sets ns to default namespace', () => {
    expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

    const log: OtlpLogRecord = {
      timeUnixNano: '1705329045123000000',
      severityNumber: 9,
      body: { stringValue: 'Test' },
    }

    const result = transformOtelLog!(log)

    expect(result.ns).toBeDefined()
    expect(typeof result.ns).toBe('string')
  })
})

// ============================================================================
// Complete Transform Tests
// ============================================================================

describe('Complete Transform', () => {
  it('transforms minimal OTEL log record', () => {
    expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

    const log: OtlpLogRecord = {
      timeUnixNano: '1705329045123000000',
    }

    const result = transformOtelLog!(log)

    expect(result.id).toBeDefined()
    expect(result.event_type).toBe('log')
    expect(result.event_name).toBe('otel.log')
    expect(result.timestamp).toBe('2024-01-15T14:30:45.123Z')
    expect(result.timestamp_ns).toBe(BigInt('1705329045123000000'))
    expect(result.log_level).toBeNull()
    expect(result.log_level_num).toBeNull()
    expect(result.log_message).toBeNull()
  })

  it('transforms complete OTEL log record', () => {
    expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

    const log: OtlpLogRecord = {
      timeUnixNano: '1705329045123456789',
      observedTimeUnixNano: '1705329045124000000',
      severityNumber: 17,
      severityText: 'ERROR',
      body: { stringValue: 'Database connection failed' },
      attributes: [
        { key: 'db.system', value: { stringValue: 'postgresql' } },
        { key: 'db.name', value: { stringValue: 'users' } },
        { key: 'error.code', value: { intValue: 5001 } },
      ],
      traceId: '5b8aa5a2d2c872e8321cf37308d69df2',
      spanId: 'acbdef0123456789',
      flags: 1,
    }

    const resource: OtlpResource = {
      attributes: [
        { key: 'service.name', value: { stringValue: 'user-api' } },
        { key: 'service.version', value: { stringValue: '2.1.0' } },
      ],
    }

    const result = transformOtelLog!(log, resource)

    // Core identity
    expect(result.event_type).toBe('log')
    expect(result.event_name).toBe('otel.log')

    // Timing
    expect(result.timestamp).toBe('2024-01-15T14:30:45.123Z')
    expect(result.timestamp_ns).toBe(BigInt('1705329045123456789'))

    // Logging
    expect(result.log_level).toBe('error')
    expect(result.log_level_num).toBe(17)
    expect(result.log_message).toBe('Database connection failed')

    // Trace context
    expect(result.trace_id).toBe('5b8aa5a2d2c872e8321cf37308d69df2')
    expect(result.span_id).toBe('acbdef0123456789')

    // Service
    expect(result.service_name).toBe('user-api')
    expect(result.service_version).toBe('2.1.0')

    // Attributes
    expect(result.attributes).toBeDefined()
    expect(result.attributes!['db.system']).toBe('postgresql')
    expect(result.attributes!['db.name']).toBe('users')
    expect(result.attributes!['error.code']).toBe(5001)
  })

  it('returns valid UnifiedEvent with all required fields', () => {
    expect(transformOtelLog, 'transformOtelLog must be defined').toBeDefined()

    const log: OtlpLogRecord = {
      timeUnixNano: '1705329045123000000',
      severityNumber: 9,
      body: { stringValue: 'Test message' },
    }

    const result = transformOtelLog!(log)

    // Required CoreIdentity fields
    expect(result.id).toBeDefined()
    expect(result.event_type).toBe('log')
    expect(result.event_name).toBeDefined()
    expect(result.ns).toBeDefined()

    // All other fields should be present (nullable ones can be null)
    expect('timestamp' in result).toBe(true)
    expect('trace_id' in result).toBe(true)
    expect('span_id' in result).toBe(true)
    expect('log_level' in result).toBe(true)
    expect('log_level_num' in result).toBe(true)
    expect('log_message' in result).toBe(true)
    expect('service_name' in result).toBe(true)
    expect('attributes' in result).toBe(true)
    expect('data' in result).toBe(true)
  })
})
