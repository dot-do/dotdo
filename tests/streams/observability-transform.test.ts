/**
 * Pipeline SQL Transform Tests for ObservabilityEvents (RED Phase)
 *
 * These tests verify the helper functions that transform ObservabilityEvents
 * for the Iceberg table format used by Cloudflare Pipelines.
 *
 * Implementation requirements:
 * - Create streams/observability.ts with transform helper functions
 * - deriveHour(timestamp) - converts Unix ms timestamp to ISO hour string
 * - deriveSeverityBucket(level) - returns 'error' for error/warn, 'normal' for others
 * - transformForIceberg(event) - maps ObservabilityEvent to Iceberg row format
 *
 * This is the RED phase of TDD - tests should fail because the
 * implementation doesn't exist yet.
 */

import { describe, it, expect } from 'vitest'

// These imports should fail until the implementation exists
import {
  deriveHour,
  deriveSeverityBucket,
  transformForIceberg,
  type IcebergRow,
} from '../../streams/observability'

import type { ObservabilityEvent } from '../../types/observability'

// ============================================================================
// Test Fixtures
// ============================================================================

function createSampleEvent(overrides: Partial<ObservabilityEvent> = {}): ObservabilityEvent {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    type: 'log',
    level: 'info',
    script: 'api-worker',
    timestamp: 1704067200000, // 2024-01-01T00:00:00.000Z
    ...overrides,
  }
}

function createFullEvent(): ObservabilityEvent {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    type: 'request',
    level: 'info',
    script: 'api-worker',
    timestamp: 1704070800000, // 2024-01-01T01:00:00.000Z
    requestId: 'req-abc123',
    method: 'POST',
    url: 'https://api.example.com.ai/users',
    status: 201,
    duration: 150,
    doName: 'CustomerDO',
    doId: 'customer-123',
    doMethod: 'createUser',
    message: ['User created successfully', 'Session started'],
    stack: undefined,
    metadata: { userId: 'user-456', action: 'signup' },
  }
}

// ============================================================================
// deriveHour Tests
// ============================================================================

describe('deriveHour', () => {
  it('converts timestamp to correct ISO hour (truncates to hour)', () => {
    // 2024-01-01T12:34:56.789Z should become 2024-01-01T12:00:00Z
    const timestamp = 1704112496789 // 2024-01-01T12:34:56.789Z
    const result = deriveHour(timestamp)

    expect(result).toBe('2024-01-01T12:00:00Z')
  })

  it('handles midnight boundary correctly', () => {
    // 2024-01-01T00:00:00.000Z should become 2024-01-01T00:00:00Z
    const timestamp = 1704067200000 // 2024-01-01T00:00:00.000Z
    const result = deriveHour(timestamp)

    expect(result).toBe('2024-01-01T00:00:00Z')
  })

  it('handles year boundary correctly', () => {
    // 2023-12-31T23:59:59.999Z should become 2023-12-31T23:00:00Z
    const timestamp = 1704067199999 // 2023-12-31T23:59:59.999Z
    const result = deriveHour(timestamp)

    expect(result).toBe('2023-12-31T23:00:00Z')
  })

  it('handles timestamps just before hour boundary', () => {
    // 2024-01-01T11:59:59.999Z should become 2024-01-01T11:00:00Z
    const timestamp = 1704110399999 // 2024-01-01T11:59:59.999Z
    const result = deriveHour(timestamp)

    expect(result).toBe('2024-01-01T11:00:00Z')
  })

  it('handles timestamps at exact hour boundary', () => {
    // 2024-01-01T12:00:00.000Z should become 2024-01-01T12:00:00Z
    const timestamp = 1704110400000 // 2024-01-01T12:00:00.000Z
    const result = deriveHour(timestamp)

    expect(result).toBe('2024-01-01T12:00:00Z')
  })

  it('handles timestamps just after hour boundary', () => {
    // 2024-01-01T12:00:00.001Z should become 2024-01-01T12:00:00Z
    const timestamp = 1704110400001 // 2024-01-01T12:00:00.001Z
    const result = deriveHour(timestamp)

    expect(result).toBe('2024-01-01T12:00:00Z')
  })
})

// ============================================================================
// deriveSeverityBucket Tests
// ============================================================================

describe('deriveSeverityBucket', () => {
  it("returns 'error' for 'error' level", () => {
    const result = deriveSeverityBucket('error')

    expect(result).toBe('error')
  })

  it("returns 'error' for 'warn' level", () => {
    const result = deriveSeverityBucket('warn')

    expect(result).toBe('error')
  })

  it("returns 'normal' for 'info' level", () => {
    const result = deriveSeverityBucket('info')

    expect(result).toBe('normal')
  })

  it("returns 'normal' for 'debug' level", () => {
    const result = deriveSeverityBucket('debug')

    expect(result).toBe('normal')
  })

  it('returns correct bucket for all valid levels', () => {
    expect(deriveSeverityBucket('debug')).toBe('normal')
    expect(deriveSeverityBucket('info')).toBe('normal')
    expect(deriveSeverityBucket('warn')).toBe('error')
    expect(deriveSeverityBucket('error')).toBe('error')
  })
})

// ============================================================================
// transformForIceberg Tests - Field Mapping
// ============================================================================

describe('transformForIceberg', () => {
  describe('field mapping', () => {
    it('maps all ObservabilityEvent fields correctly', () => {
      const event = createFullEvent()
      const result = transformForIceberg(event)

      expect(result.id).toBe(event.id)
      expect(result.type).toBe(event.type)
      expect(result.level).toBe(event.level)
      expect(result.script).toBe(event.script)
      expect(result.timestamp).toBe(event.timestamp)
      expect(result.request_id).toBe(event.requestId)
      expect(result.method).toBe(event.method)
      expect(result.url).toBe(event.url)
      expect(result.status).toBe(event.status)
      expect(result.duration_ms).toBe(event.duration)
      expect(result.do_name).toBe(event.doName)
      expect(result.do_id).toBe(event.doId)
      expect(result.do_method).toBe(event.doMethod)
      expect(result.stack).toBeNull() // undefined should become null
    })

    it('maps camelCase fields to snake_case', () => {
      const event = createSampleEvent({
        requestId: 'req-123',
        doName: 'TestDO',
        doId: 'do-456',
        doMethod: 'testMethod',
      })
      const result = transformForIceberg(event)

      // Verify snake_case field names
      expect(result).toHaveProperty('request_id')
      expect(result).toHaveProperty('do_name')
      expect(result).toHaveProperty('do_id')
      expect(result).toHaveProperty('do_method')
      expect(result).toHaveProperty('duration_ms')

      // Should NOT have camelCase names
      expect(result).not.toHaveProperty('requestId')
      expect(result).not.toHaveProperty('doName')
      expect(result).not.toHaveProperty('doId')
      expect(result).not.toHaveProperty('doMethod')
    })

    it('converts undefined optional fields to null', () => {
      const event = createSampleEvent() // Minimal event with no optional fields
      const result = transformForIceberg(event)

      expect(result.request_id).toBeNull()
      expect(result.method).toBeNull()
      expect(result.url).toBeNull()
      expect(result.status).toBeNull()
      expect(result.duration_ms).toBeNull()
      expect(result.do_name).toBeNull()
      expect(result.do_id).toBeNull()
      expect(result.do_method).toBeNull()
      expect(result.message).toBeNull()
      expect(result.stack).toBeNull()
      expect(result.metadata).toBeNull()
    })
  })

  describe('partition columns', () => {
    it('adds hour partition column', () => {
      const event = createSampleEvent({
        timestamp: 1704112496789, // 2024-01-01T12:34:56.789Z
      })
      const result = transformForIceberg(event)

      expect(result).toHaveProperty('hour')
      expect(result.hour).toBe('2024-01-01T12:00:00Z')
    })

    it('adds severity_bucket partition column', () => {
      const event = createSampleEvent({ level: 'error' })
      const result = transformForIceberg(event)

      expect(result).toHaveProperty('severity_bucket')
      expect(result.severity_bucket).toBe('error')
    })

    it("severity_bucket is 'error' for error level", () => {
      const event = createSampleEvent({ level: 'error' })
      const result = transformForIceberg(event)

      expect(result.severity_bucket).toBe('error')
    })

    it("severity_bucket is 'error' for warn level", () => {
      const event = createSampleEvent({ level: 'warn' })
      const result = transformForIceberg(event)

      expect(result.severity_bucket).toBe('error')
    })

    it("severity_bucket is 'normal' for info level", () => {
      const event = createSampleEvent({ level: 'info' })
      const result = transformForIceberg(event)

      expect(result.severity_bucket).toBe('normal')
    })

    it("severity_bucket is 'normal' for debug level", () => {
      const event = createSampleEvent({ level: 'debug' })
      const result = transformForIceberg(event)

      expect(result.severity_bucket).toBe('normal')
    })
  })

  describe('JSON serialization', () => {
    it('serializes message array to JSON', () => {
      const event = createSampleEvent({
        message: ['First message', 'Second message', 'Third message'],
      })
      const result = transformForIceberg(event)

      expect(typeof result.message).toBe('string')
      expect(result.message).toBe('["First message","Second message","Third message"]')
    })

    it('serializes empty message array to JSON', () => {
      const event = createSampleEvent({
        message: [],
      })
      const result = transformForIceberg(event)

      expect(typeof result.message).toBe('string')
      expect(result.message).toBe('[]')
    })

    it('serializes metadata to JSON', () => {
      const event = createSampleEvent({
        metadata: {
          userId: 'user-123',
          action: 'login',
          nested: { value: 42 },
        },
      })
      const result = transformForIceberg(event)

      expect(typeof result.metadata).toBe('string')
      const parsed = JSON.parse(result.metadata!)
      expect(parsed).toEqual({
        userId: 'user-123',
        action: 'login',
        nested: { value: 42 },
      })
    })

    it('serializes empty metadata object to JSON', () => {
      const event = createSampleEvent({
        metadata: {},
      })
      const result = transformForIceberg(event)

      expect(typeof result.metadata).toBe('string')
      expect(result.metadata).toBe('{}')
    })

    it('returns null for undefined message', () => {
      const event = createSampleEvent({
        message: undefined,
      })
      const result = transformForIceberg(event)

      expect(result.message).toBeNull()
    })

    it('returns null for undefined metadata', () => {
      const event = createSampleEvent({
        metadata: undefined,
      })
      const result = transformForIceberg(event)

      expect(result.metadata).toBeNull()
    })
  })

  describe('output schema compliance', () => {
    it('produces IcebergRow with correct structure', () => {
      const event = createFullEvent()
      const result = transformForIceberg(event)

      // Required fields
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('level')
      expect(result).toHaveProperty('script')
      expect(result).toHaveProperty('timestamp')
      expect(result).toHaveProperty('hour')
      expect(result).toHaveProperty('severity_bucket')

      // Optional fields (nullable)
      expect(result).toHaveProperty('request_id')
      expect(result).toHaveProperty('method')
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('status')
      expect(result).toHaveProperty('duration_ms')
      expect(result).toHaveProperty('do_name')
      expect(result).toHaveProperty('do_id')
      expect(result).toHaveProperty('do_method')
      expect(result).toHaveProperty('message')
      expect(result).toHaveProperty('stack')
      expect(result).toHaveProperty('metadata')
    })

    it('has correct types for all fields', () => {
      const event = createFullEvent()
      const result = transformForIceberg(event)

      // String fields
      expect(typeof result.id).toBe('string')
      expect(typeof result.type).toBe('string')
      expect(typeof result.level).toBe('string')
      expect(typeof result.script).toBe('string')
      expect(typeof result.hour).toBe('string')
      expect(typeof result.severity_bucket).toBe('string')

      // Number field
      expect(typeof result.timestamp).toBe('number')

      // Nullable string fields
      expect(typeof result.request_id).toBe('string')
      expect(typeof result.method).toBe('string')
      expect(typeof result.url).toBe('string')
      expect(typeof result.do_name).toBe('string')
      expect(typeof result.do_id).toBe('string')
      expect(typeof result.do_method).toBe('string')
      expect(typeof result.message).toBe('string') // JSON serialized
      expect(typeof result.metadata).toBe('string') // JSON serialized

      // Nullable number fields
      expect(typeof result.status).toBe('number')
      expect(typeof result.duration_ms).toBe('number')
    })
  })
})

// ============================================================================
// Type Definition Tests
// ============================================================================

describe('IcebergRow Type Definition', () => {
  it('should define IcebergRow interface with all required fields', () => {
    // This test verifies the IcebergRow type exists and has correct shape
    const row: IcebergRow = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      request_id: null,
      method: null,
      url: null,
      status: null,
      duration_ms: null,
      do_name: null,
      do_id: null,
      do_method: null,
      message: null,
      stack: null,
      metadata: null,
      hour: '2024-01-01T00:00:00Z',
      severity_bucket: 'normal',
    }

    expect(row).toBeDefined()
    expect(row.id).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(row.hour).toBe('2024-01-01T00:00:00Z')
    expect(row.severity_bucket).toBe('normal')
  })

  it('hour field is required (not optional)', () => {
    // TypeScript will catch this at compile time
    const row: IcebergRow = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      request_id: null,
      method: null,
      url: null,
      status: null,
      duration_ms: null,
      do_name: null,
      do_id: null,
      do_method: null,
      message: null,
      stack: null,
      metadata: null,
      hour: '2024-01-01T00:00:00Z', // Required
      severity_bucket: 'normal',
    }

    expect(row.hour).toBeDefined()
  })

  it('severity_bucket field is required (not optional)', () => {
    // TypeScript will catch this at compile time
    const row: IcebergRow = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      request_id: null,
      method: null,
      url: null,
      status: null,
      duration_ms: null,
      do_name: null,
      do_id: null,
      do_method: null,
      message: null,
      stack: null,
      metadata: null,
      hour: '2024-01-01T00:00:00Z',
      severity_bucket: 'normal', // Required
    }

    expect(row.severity_bucket).toBeDefined()
  })

  it('severity_bucket accepts valid values', () => {
    const errorBucket: IcebergRow['severity_bucket'] = 'error'
    const normalBucket: IcebergRow['severity_bucket'] = 'normal'

    expect(errorBucket).toBe('error')
    expect(normalBucket).toBe('normal')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('handles exception event with stack trace', () => {
    const event = createSampleEvent({
      type: 'exception',
      level: 'error',
      message: ['TypeError: Cannot read property of undefined'],
      stack: 'TypeError: Cannot read property of undefined\n    at handler (/src/index.ts:42:10)',
    })
    const result = transformForIceberg(event)

    expect(result.type).toBe('exception')
    expect(result.severity_bucket).toBe('error')
    expect(result.stack).toBe(event.stack)
    expect(result.message).toBe('["TypeError: Cannot read property of undefined"]')
  })

  it('handles do_method event with all DO fields', () => {
    const event = createSampleEvent({
      type: 'do_method',
      level: 'info',
      doName: 'CustomerDO',
      doId: 'customer-123',
      doMethod: 'updateProfile',
      duration: 45,
    })
    const result = transformForIceberg(event)

    expect(result.type).toBe('do_method')
    expect(result.do_name).toBe('CustomerDO')
    expect(result.do_id).toBe('customer-123')
    expect(result.do_method).toBe('updateProfile')
    expect(result.duration_ms).toBe(45)
  })

  it('handles request event with all HTTP fields', () => {
    const event = createSampleEvent({
      type: 'request',
      level: 'info',
      requestId: 'req-abc123',
      method: 'POST',
      url: 'https://api.example.com.ai/users',
      status: 201,
      duration: 150,
    })
    const result = transformForIceberg(event)

    expect(result.type).toBe('request')
    expect(result.request_id).toBe('req-abc123')
    expect(result.method).toBe('POST')
    expect(result.url).toBe('https://api.example.com.ai/users')
    expect(result.status).toBe(201)
    expect(result.duration_ms).toBe(150)
  })

  it('handles metadata with special characters', () => {
    const event = createSampleEvent({
      metadata: {
        query: 'SELECT * FROM users WHERE name = "O\'Brien"',
        unicode: '\u2603 snowman',
        newlines: 'line1\nline2',
      },
    })
    const result = transformForIceberg(event)

    expect(typeof result.metadata).toBe('string')
    const parsed = JSON.parse(result.metadata!)
    expect(parsed.query).toBe('SELECT * FROM users WHERE name = "O\'Brien"')
    expect(parsed.unicode).toBe('\u2603 snowman')
    expect(parsed.newlines).toBe('line1\nline2')
  })

  it('handles timestamp at Unix epoch', () => {
    const event = createSampleEvent({
      timestamp: 0, // Unix epoch: 1970-01-01T00:00:00.000Z
    })
    const result = transformForIceberg(event)

    expect(result.timestamp).toBe(0)
    expect(result.hour).toBe('1970-01-01T00:00:00Z')
  })

  it('handles very large timestamps (far future)', () => {
    const event = createSampleEvent({
      timestamp: 4102444800000, // 2100-01-01T00:00:00.000Z
    })
    const result = transformForIceberg(event)

    expect(result.timestamp).toBe(4102444800000)
    expect(result.hour).toBe('2100-01-01T00:00:00Z')
  })
})
