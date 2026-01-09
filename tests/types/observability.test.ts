import { describe, it, expect } from 'vitest'

/**
 * ObservabilityEvent Type and Zod Schema Tests (RED Phase)
 *
 * These tests verify the ObservabilityEvent type for logging, exceptions,
 * requests, and DO method calls in the observability system.
 *
 * Implementation requirements:
 * - Create types/observability.ts with the ObservabilityEvent interface
 * - Define type and level enums
 * - Create ObservabilityEventSchema for runtime validation
 * - Export from types/index.ts
 *
 * This is the RED phase of TDD - tests should fail because the
 * implementation doesn't exist yet.
 */

// These imports should fail until the types are implemented
import type { ObservabilityEvent } from '../../types/observability'
import {
  ObservabilityEventSchema,
  validateObservabilityEvent,
} from '../../types/observability'

// ============================================================================
// Type Definition Tests
// ============================================================================

describe('ObservabilityEvent Type Definition', () => {
  it('should define ObservabilityEvent interface with all required fields', () => {
    // This test verifies the ObservabilityEvent type exists with all required fields
    const event: ObservabilityEvent = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
    }

    expect(event).toBeDefined()
    expect(event.id).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(event.type).toBe('log')
    expect(event.level).toBe('info')
    expect(event.script).toBe('api-worker')
    expect(event.timestamp).toBeDefined()
  })

  it('should accept all valid type values', () => {
    const types: ObservabilityEvent['type'][] = ['log', 'exception', 'request', 'do_method']

    for (const type of types) {
      const event: ObservabilityEvent = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type,
        level: 'info',
        script: 'api-worker',
        timestamp: Date.now(),
      }
      expect(event.type).toBe(type)
    }
  })

  it('should accept all valid level values', () => {
    const levels: ObservabilityEvent['level'][] = ['debug', 'info', 'warn', 'error']

    for (const level of levels) {
      const event: ObservabilityEvent = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'log',
        level,
        script: 'api-worker',
        timestamp: Date.now(),
      }
      expect(event.level).toBe(level)
    }
  })
})

// ============================================================================
// Valid Event Tests
// ============================================================================

describe('Valid ObservabilityEvent', () => {
  it('should validate event with all required fields', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
    })

    expect(result.success).toBe(true)
  })

  it('should validate log event with message array', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      message: ['User logged in', 'Session started'],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.message).toEqual(['User logged in', 'Session started'])
    }
  })

  it('should validate exception event with stack trace', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'exception',
      level: 'error',
      script: 'api-worker',
      timestamp: Date.now(),
      message: ['TypeError: Cannot read property of undefined'],
      stack: 'TypeError: Cannot read property of undefined\n    at handler (/src/index.ts:42:10)\n    at processRequest (/src/router.ts:15:5)',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('exception')
      expect(result.data.stack).toBeDefined()
      expect(result.data.stack).toContain('TypeError')
    }
  })

  it('should validate request event with HTTP metadata', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'request',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      requestId: 'req-abc123',
      method: 'POST',
      url: 'https://api.example.com/users',
      status: 201,
      duration: 150,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('request')
      expect(result.data.requestId).toBe('req-abc123')
      expect(result.data.method).toBe('POST')
      expect(result.data.url).toBe('https://api.example.com/users')
      expect(result.data.status).toBe(201)
      expect(result.data.duration).toBe(150)
    }
  })

  it('should validate do_method event with DO context', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'do_method',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      doName: 'CustomerDO',
      doId: 'customer-123',
      doMethod: 'updateProfile',
      duration: 45,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('do_method')
      expect(result.data.doName).toBe('CustomerDO')
      expect(result.data.doId).toBe('customer-123')
      expect(result.data.doMethod).toBe('updateProfile')
    }
  })

  it('should validate event with metadata', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'debug',
      script: 'api-worker',
      timestamp: Date.now(),
      metadata: {
        userId: 'user-456',
        action: 'checkout',
        cartItems: 3,
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata).toEqual({
        userId: 'user-456',
        action: 'checkout',
        cartItems: 3,
      })
    }
  })
})

// ============================================================================
// Invalid Event Tests - Missing Required Fields
// ============================================================================

describe('Invalid ObservabilityEvent - Missing Required Fields', () => {
  it('should fail validation when missing required id field', () => {
    const result = ObservabilityEventSchema.safeParse({
      // id is missing
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const idError = result.error.issues.find((issue) => issue.path.includes('id'))
      expect(idError).toBeDefined()
    }
  })

  it('should fail validation when missing required type field', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      // type is missing
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const typeError = result.error.issues.find((issue) => issue.path.includes('type'))
      expect(typeError).toBeDefined()
    }
  })

  it('should fail validation when missing required level field', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      // level is missing
      script: 'api-worker',
      timestamp: Date.now(),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const levelError = result.error.issues.find((issue) => issue.path.includes('level'))
      expect(levelError).toBeDefined()
    }
  })

  it('should fail validation when missing required script field', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      // script is missing
      timestamp: Date.now(),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const scriptError = result.error.issues.find((issue) => issue.path.includes('script'))
      expect(scriptError).toBeDefined()
    }
  })

  it('should fail validation when missing required timestamp field', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      // timestamp is missing
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const timestampError = result.error.issues.find((issue) => issue.path.includes('timestamp'))
      expect(timestampError).toBeDefined()
    }
  })
})

// ============================================================================
// Invalid Event Tests - Wrong Enum Values
// ============================================================================

describe('Invalid ObservabilityEvent - Wrong Enum Values', () => {
  it('should fail validation with invalid type enum value', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'invalid_type', // Not a valid type
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const typeError = result.error.issues.find((issue) => issue.path.includes('type'))
      expect(typeError).toBeDefined()
    }
  })

  it('should fail validation with invalid level enum value', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'critical', // Not a valid level (should be debug/info/warn/error)
      script: 'api-worker',
      timestamp: Date.now(),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const levelError = result.error.issues.find((issue) => issue.path.includes('level'))
      expect(levelError).toBeDefined()
    }
  })
})

// ============================================================================
// Invalid Event Tests - Invalid Field Values
// ============================================================================

describe('Invalid ObservabilityEvent - Invalid Field Values', () => {
  it('should fail validation with invalid status code below 100', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'request',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      status: 50, // Invalid: below 100
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const statusError = result.error.issues.find((issue) => issue.path.includes('status'))
      expect(statusError).toBeDefined()
    }
  })

  it('should fail validation with invalid status code above 599', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'request',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      status: 600, // Invalid: above 599
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const statusError = result.error.issues.find((issue) => issue.path.includes('status'))
      expect(statusError).toBeDefined()
    }
  })

  it('should fail validation with negative timestamp', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: -1, // Invalid: negative timestamp
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const timestampError = result.error.issues.find((issue) => issue.path.includes('timestamp'))
      expect(timestampError).toBeDefined()
    }
  })

  it('should fail validation with invalid UUID format for id', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: 'not-a-valid-uuid', // Invalid UUID format
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const idError = result.error.issues.find((issue) => issue.path.includes('id'))
      expect(idError).toBeDefined()
    }
  })

  it('should fail validation with empty script name', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: '', // Invalid: empty string
      timestamp: Date.now(),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      const scriptError = result.error.issues.find((issue) => issue.path.includes('script'))
      expect(scriptError).toBeDefined()
    }
  })
})

// ============================================================================
// validateObservabilityEvent Function Tests
// ============================================================================

describe('validateObservabilityEvent', () => {
  it('should return success for valid event', () => {
    const result = validateObservabilityEvent({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
    })

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should return errors for invalid event', () => {
    const result = validateObservabilityEvent({
      id: 'invalid-uuid',
      type: 'invalid_type' as any,
      level: 'critical' as any,
      script: '',
      timestamp: -1,
    })

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should include field path in error details', () => {
    const result = validateObservabilityEvent({
      id: '', // Invalid
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
    })

    expect(result.success).toBe(false)
    expect(result.errors[0]).toHaveProperty('field')
    expect(result.errors[0]).toHaveProperty('message')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('ObservabilityEvent Edge Cases', () => {
  it('should accept valid HTTP status codes at boundaries (100 and 599)', () => {
    const result100 = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'request',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      status: 100, // Valid boundary
    })

    const result599 = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'request',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      status: 599, // Valid boundary
    })

    expect(result100.success).toBe(true)
    expect(result599.success).toBe(true)
  })

  it('should accept timestamp at 0 (Unix epoch)', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: 0, // Unix epoch - valid
    })

    expect(result.success).toBe(true)
  })

  it('should accept empty message array', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      message: [], // Empty array is valid
    })

    expect(result.success).toBe(true)
  })

  it('should accept empty metadata object', () => {
    const result = ObservabilityEventSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      type: 'log',
      level: 'info',
      script: 'api-worker',
      timestamp: Date.now(),
      metadata: {}, // Empty object is valid
    })

    expect(result.success).toBe(true)
  })
})
