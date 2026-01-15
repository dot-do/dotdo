/**
 * Tests for toStoredUnifiedEvent shared utility
 *
 * TDD RED PHASE - These tests are written BEFORE the implementation.
 * The function should be extracted from duplicated implementations in:
 * - streaming/event-stream-do.ts
 * - streaming/event-stream/event-store.ts
 * - streaming/tests/utils/mock-pglite.ts
 *
 * @issue do-ekak - RED: toStoredUnifiedEvent shared utility tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
// This import will fail until the shared utility is created (RED phase)
import { toStoredUnifiedEvent } from './event-converter'
import type { UnifiedEvent } from '../../../types/unified-event'

// Type for legacy BroadcastEvent format
interface BroadcastEvent {
  id: string
  type: string
  topic: string
  payload: unknown
  timestamp: number
  [key: string]: unknown
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

const createValidUnifiedEvent = (overrides: Partial<UnifiedEvent> = {}): Partial<UnifiedEvent> => ({
  id: 'test-event-123',
  event_type: 'trace',
  event_name: 'http.request',
  ns: 'https://api.example.com',
  timestamp: '2024-01-15T12:00:00.000Z',
  trace_id: 'abc123def456',
  span_id: 'span-001',
  parent_id: 'parent-span-000',
  session_id: 'session-xyz',
  correlation_id: 'corr-789',
  outcome: 'success',
  http_url: 'https://api.example.com/users',
  http_status: 200,
  duration_ms: 150,
  service_name: 'user-service',
  vital_name: null,
  vital_value: null,
  vital_rating: null,
  log_level: null,
  log_message: null,
  actor_id: 'user-456',
  data: { userId: 123, action: 'login' },
  attributes: { env: 'production' },
  properties: { version: '1.0.0' },
  ...overrides,
})

const createLegacyBroadcastEvent = (overrides: Partial<BroadcastEvent> = {}): BroadcastEvent => ({
  id: 'legacy-event-456',
  type: 'user.signup',
  topic: 'users',
  payload: { email: 'test@example.com' },
  timestamp: 1705320000000,
  ...overrides,
})

// ============================================================================
// UNIFIED EVENT TRANSFORMATION TESTS
// ============================================================================

describe('toStoredUnifiedEvent', () => {
  describe('UnifiedEvent transformation', () => {
    it('should convert a valid UnifiedEvent to StoredUnifiedEvent', () => {
      const event = createValidUnifiedEvent()
      const stored = toStoredUnifiedEvent(event)

      expect(stored.id).toBe('test-event-123')
      expect(stored.event_type).toBe('trace')
      expect(stored.event_name).toBe('http.request')
      expect(stored.ns).toBe('https://api.example.com')
    })

    it('should preserve all core identity fields', () => {
      const event = createValidUnifiedEvent()
      const stored = toStoredUnifiedEvent(event)

      expect(stored.id).toBe(event.id)
      expect(stored.event_type).toBe(event.event_type)
      expect(stored.event_name).toBe(event.event_name)
      expect(stored.ns).toBe(event.ns)
    })

    it('should preserve all causality chain fields', () => {
      const event = createValidUnifiedEvent()
      const stored = toStoredUnifiedEvent(event)

      expect(stored.trace_id).toBe('abc123def456')
      expect(stored.span_id).toBe('span-001')
      expect(stored.parent_id).toBe('parent-span-000')
      expect(stored.session_id).toBe('session-xyz')
      expect(stored.correlation_id).toBe('corr-789')
    })

    it('should preserve timing fields', () => {
      const event = createValidUnifiedEvent()
      const stored = toStoredUnifiedEvent(event)

      expect(stored.timestamp).toBe('2024-01-15T12:00:00.000Z')
      expect(stored.duration_ms).toBe(150)
    })

    it('should preserve HTTP context fields', () => {
      const event = createValidUnifiedEvent()
      const stored = toStoredUnifiedEvent(event)

      expect(stored.http_url).toBe('https://api.example.com/users')
      expect(stored.http_status).toBe(200)
    })

    it('should preserve outcome field', () => {
      const event = createValidUnifiedEvent({ outcome: 'error' })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.outcome).toBe('error')
    })

    it('should preserve service fields', () => {
      const event = createValidUnifiedEvent()
      const stored = toStoredUnifiedEvent(event)

      expect(stored.service_name).toBe('user-service')
    })

    it('should preserve vital fields', () => {
      const event = createValidUnifiedEvent({
        vital_name: 'LCP',
        vital_value: 2500,
        vital_rating: 'needs-improvement',
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.vital_name).toBe('LCP')
      expect(stored.vital_value).toBe(2500)
      expect(stored.vital_rating).toBe('needs-improvement')
    })

    it('should preserve logging fields', () => {
      const event = createValidUnifiedEvent({
        log_level: 'error',
        log_message: 'Connection failed',
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.log_level).toBe('error')
      expect(stored.log_message).toBe('Connection failed')
    })

    it('should preserve actor field', () => {
      const event = createValidUnifiedEvent()
      const stored = toStoredUnifiedEvent(event)

      expect(stored.actor_id).toBe('user-456')
    })

    it('should serialize data field as JSON string', () => {
      const event = createValidUnifiedEvent({
        data: { userId: 123, action: 'login' },
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.data).toBe(JSON.stringify({ userId: 123, action: 'login' }))
    })

    it('should serialize attributes field as JSON string', () => {
      const event = createValidUnifiedEvent({
        attributes: { env: 'production', region: 'us-west-2' },
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.attributes).toBe(JSON.stringify({ env: 'production', region: 'us-west-2' }))
    })

    it('should serialize properties field as JSON string', () => {
      const event = createValidUnifiedEvent({
        properties: { version: '1.0.0', build: '12345' },
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.properties).toBe(JSON.stringify({ version: '1.0.0', build: '12345' }))
    })
  })

  // ============================================================================
  // REQUIRED FIELD VALIDATION TESTS
  // ============================================================================

  describe('required field validation', () => {
    it('should throw error when id is missing', () => {
      const event = createValidUnifiedEvent()
      delete (event as Record<string, unknown>).id

      expect(() => toStoredUnifiedEvent(event)).toThrow('id field is required')
    })

    it('should throw error when id is not a string', () => {
      const event = createValidUnifiedEvent({ id: 123 as unknown as string })

      expect(() => toStoredUnifiedEvent(event)).toThrow('id field is required')
    })

    it('should throw error when event_type is missing', () => {
      const event = createValidUnifiedEvent()
      delete (event as Record<string, unknown>).event_type

      expect(() => toStoredUnifiedEvent(event)).toThrow('event_type field is required')
    })

    it('should throw error when event_name is missing', () => {
      const event = createValidUnifiedEvent()
      delete (event as Record<string, unknown>).event_name

      expect(() => toStoredUnifiedEvent(event)).toThrow('event_name field is required')
    })

    it('should throw error when ns is missing', () => {
      const event = createValidUnifiedEvent()
      delete (event as Record<string, unknown>).ns

      expect(() => toStoredUnifiedEvent(event)).toThrow('ns field is required')
    })
  })

  // ============================================================================
  // NULL/UNDEFINED HANDLING TESTS
  // ============================================================================

  describe('null and undefined field handling', () => {
    it('should convert undefined causality fields to null', () => {
      const event = createValidUnifiedEvent({
        trace_id: undefined,
        span_id: undefined,
        parent_id: undefined,
        session_id: undefined,
        correlation_id: undefined,
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.trace_id).toBeNull()
      expect(stored.span_id).toBeNull()
      expect(stored.parent_id).toBeNull()
      expect(stored.session_id).toBeNull()
      expect(stored.correlation_id).toBeNull()
    })

    it('should convert undefined optional fields to null', () => {
      const event: Partial<UnifiedEvent> = {
        id: 'test-123',
        event_type: 'trace',
        event_name: 'test.event',
        ns: 'test-ns',
      }
      const stored = toStoredUnifiedEvent(event)

      expect(stored.outcome).toBeNull()
      expect(stored.http_url).toBeNull()
      expect(stored.http_status).toBeNull()
      expect(stored.duration_ms).toBeNull()
      expect(stored.service_name).toBeNull()
      expect(stored.vital_name).toBeNull()
      expect(stored.vital_value).toBeNull()
      expect(stored.vital_rating).toBeNull()
      expect(stored.log_level).toBeNull()
      expect(stored.log_message).toBeNull()
      expect(stored.actor_id).toBeNull()
    })

    it('should handle null data field', () => {
      const event = createValidUnifiedEvent({ data: null })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.data).toBeNull()
    })

    it('should handle undefined data field', () => {
      const event = createValidUnifiedEvent({ data: undefined })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.data).toBeNull()
    })

    it('should handle null attributes field', () => {
      const event = createValidUnifiedEvent({ attributes: null })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.attributes).toBeNull()
    })

    it('should handle null properties field', () => {
      const event = createValidUnifiedEvent({ properties: null })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.properties).toBeNull()
    })

    it('should handle empty objects for JSON fields', () => {
      const event = createValidUnifiedEvent({
        data: {},
        attributes: {},
        properties: {},
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.data).toBe('{}')
      expect(stored.attributes).toBe('{}')
      expect(stored.properties).toBe('{}')
    })
  })

  // ============================================================================
  // TIMESTAMP HANDLING TESTS
  // ============================================================================

  describe('timestamp handling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'))
    })

    it('should preserve ISO string timestamp', () => {
      const event = createValidUnifiedEvent({
        timestamp: '2024-01-10T08:30:00.000Z',
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.timestamp).toBe('2024-01-10T08:30:00.000Z')
    })

    it('should use current time when timestamp is missing', () => {
      const event = createValidUnifiedEvent()
      delete (event as Record<string, unknown>).timestamp
      const stored = toStoredUnifiedEvent(event)

      expect(stored.timestamp).toBe('2024-01-15T12:00:00.000Z')
    })

    it('should use current time when timestamp is undefined', () => {
      const event = createValidUnifiedEvent({ timestamp: undefined })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.timestamp).toBe('2024-01-15T12:00:00.000Z')
    })
  })

  // ============================================================================
  // LEGACY BROADCASTEVENT SUPPORT TESTS
  // ============================================================================

  describe('legacy BroadcastEvent support', () => {
    it('should detect and convert legacy BroadcastEvent format', () => {
      const legacy = createLegacyBroadcastEvent()
      const stored = toStoredUnifiedEvent(legacy)

      expect(stored.id).toBe('legacy-event-456')
      expect(stored.event_type).toBe('user.signup')
      expect(stored.event_name).toBe('user.signup')
      expect(stored.ns).toBe('users')
    })

    it('should convert numeric timestamp to ISO string for legacy events', () => {
      const legacy = createLegacyBroadcastEvent({
        timestamp: 1705320000000, // 2024-01-15T12:00:00.000Z
      })
      const stored = toStoredUnifiedEvent(legacy)

      expect(stored.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
    })

    it('should serialize legacy payload to data field', () => {
      const legacy = createLegacyBroadcastEvent({
        payload: { email: 'test@example.com', name: 'Test User' },
      })
      const stored = toStoredUnifiedEvent(legacy)

      expect(stored.data).toBe(JSON.stringify({ email: 'test@example.com', name: 'Test User' }))
    })

    it('should set causality fields to null for legacy events', () => {
      const legacy = createLegacyBroadcastEvent()
      const stored = toStoredUnifiedEvent(legacy)

      expect(stored.trace_id).toBeNull()
      expect(stored.span_id).toBeNull()
      expect(stored.parent_id).toBeNull()
      expect(stored.session_id).toBeNull()
      expect(stored.correlation_id).toBeNull()
    })

    it('should preserve topic in legacy compatibility field', () => {
      const legacy = createLegacyBroadcastEvent({ topic: 'orders' })
      const stored = toStoredUnifiedEvent(legacy)

      expect(stored.topic).toBe('orders')
    })

    it('should preserve type in legacy compatibility field', () => {
      const legacy = createLegacyBroadcastEvent({ type: 'order.created' })
      const stored = toStoredUnifiedEvent(legacy)

      expect(stored.type).toBe('order.created')
    })

    it('should preserve payload in legacy compatibility field', () => {
      const legacy = createLegacyBroadcastEvent({
        payload: { orderId: 123 },
      })
      const stored = toStoredUnifiedEvent(legacy)

      expect(stored.payload).toEqual({ orderId: 123 })
    })

    it('should handle legacy event with null payload', () => {
      const legacy = createLegacyBroadcastEvent({ payload: null })
      const stored = toStoredUnifiedEvent(legacy)

      expect(stored.data).toBeNull()
    })

    it('should handle legacy event with undefined timestamp', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'))

      const legacy = createLegacyBroadcastEvent()
      delete (legacy as Record<string, unknown>).timestamp
      const stored = toStoredUnifiedEvent(legacy)

      expect(stored.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
    })
  })

  // ============================================================================
  // BACKWARDS COMPATIBILITY FIELD MAPPING TESTS
  // ============================================================================

  describe('backwards compatibility field mapping', () => {
    it('should map ns to topic for unified events', () => {
      const event = createValidUnifiedEvent({ ns: 'production-ns' })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.topic).toBe('production-ns')
    })

    it('should map event_type to type for unified events', () => {
      const event = createValidUnifiedEvent({ event_type: 'log' })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.type).toBe('log')
    })
  })

  // ============================================================================
  // EDGE CASES AND SPECIAL VALUES TESTS
  // ============================================================================

  describe('edge cases and special values', () => {
    it('should handle empty string for optional fields', () => {
      const event = createValidUnifiedEvent({
        trace_id: '',
        service_name: '',
      })
      const stored = toStoredUnifiedEvent(event)

      // Empty strings should be normalized to null or preserved based on implementation
      expect(stored.trace_id === null || stored.trace_id === '').toBe(true)
    })

    it('should handle zero values for numeric fields', () => {
      const event = createValidUnifiedEvent({
        http_status: 0,
        duration_ms: 0,
        vital_value: 0,
      })
      const stored = toStoredUnifiedEvent(event)

      // Zero is a valid value and should be preserved
      expect(stored.http_status).toBe(0)
      expect(stored.duration_ms).toBe(0)
      expect(stored.vital_value).toBe(0)
    })

    it('should handle special characters in string fields', () => {
      const event = createValidUnifiedEvent({
        event_name: 'user.signup:v2',
        ns: 'https://api.example.com/v1?tenant=acme',
        log_message: 'Error: Connection failed "timeout"',
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.event_name).toBe('user.signup:v2')
      expect(stored.ns).toBe('https://api.example.com/v1?tenant=acme')
      expect(stored.log_message).toBe('Error: Connection failed "timeout"')
    })

    it('should handle deeply nested data objects', () => {
      const event = createValidUnifiedEvent({
        data: {
          level1: {
            level2: {
              level3: {
                value: 'deep',
              },
            },
          },
        },
      })
      const stored = toStoredUnifiedEvent(event)

      const parsed = JSON.parse(stored.data!)
      expect(parsed.level1.level2.level3.value).toBe('deep')
    })

    it('should handle arrays in JSON fields', () => {
      const event = createValidUnifiedEvent({
        data: { tags: ['a', 'b', 'c'], counts: [1, 2, 3] },
      })
      const stored = toStoredUnifiedEvent(event)

      const parsed = JSON.parse(stored.data!)
      expect(parsed.tags).toEqual(['a', 'b', 'c'])
      expect(parsed.counts).toEqual([1, 2, 3])
    })

    it('should handle unicode characters', () => {
      const event = createValidUnifiedEvent({
        log_message: 'User login: \u4e2d\u6587 \u0440\u0443\u0441\u0441\u043a\u0438\u0439',
        data: { name: '\ud83d\ude00 Emoji User' },
      })
      const stored = toStoredUnifiedEvent(event)

      expect(stored.log_message).toBe('User login: \u4e2d\u6587 \u0440\u0443\u0441\u0441\u043a\u0438\u0439')
      const parsed = JSON.parse(stored.data!)
      expect(parsed.name).toBe('\ud83d\ude00 Emoji User')
    })
  })

  // ============================================================================
  // TYPE DISCRIMINATION TESTS
  // ============================================================================

  describe('type discrimination between UnifiedEvent and BroadcastEvent', () => {
    it('should identify event with event_type as UnifiedEvent', () => {
      const event = {
        id: 'test-123',
        event_type: 'trace',
        event_name: 'test.event',
        ns: 'test-ns',
        topic: 'ignored', // Should be ignored because event_type is present
        type: 'ignored',
      }
      const stored = toStoredUnifiedEvent(event)

      // Should use UnifiedEvent path, not legacy
      expect(stored.event_type).toBe('trace')
      expect(stored.event_name).toBe('test.event')
    })

    it('should identify event without event_type but with topic/type as legacy', () => {
      const legacy = {
        id: 'legacy-123',
        type: 'order.created',
        topic: 'orders',
        payload: { orderId: 1 },
        timestamp: Date.now(),
      }
      const stored = toStoredUnifiedEvent(legacy)

      // Should use legacy path
      expect(stored.event_type).toBe('order.created')
      expect(stored.ns).toBe('orders')
    })
  })
})
