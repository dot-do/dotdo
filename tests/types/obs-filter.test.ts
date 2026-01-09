import { describe, it, expect } from 'vitest'

/**
 * RED Phase Tests for ObsFilter Type and Matching Logic
 *
 * These tests define the expected behavior for observability event filtering.
 * They will FAIL until the implementation is created in types/observability.ts
 *
 * ObsFilter is used to filter observability events in:
 * - REST API queries (GET /api/obs/logs?level=error)
 * - WebSocket subscriptions (real-time filtered log streaming)
 *
 * Filter fields use AND logic - all specified fields must match.
 */

// These imports should fail until the types are implemented
import type { ObsFilter, ObservabilityEvent } from '../../types/observability'
import {
  matchesFilter,
  validateObsFilter,
  ObsFilterSchema,
} from '../../types/observability'

// ============================================================================
// Type Definition Tests
// ============================================================================

describe('ObsFilter Type Definition', () => {
  it('should define ObsFilter interface with all optional fields', () => {
    // All fields in ObsFilter should be optional for flexible filtering
    const filter: ObsFilter = {}

    expect(filter).toBeDefined()
    expect(filter.level).toBeUndefined()
    expect(filter.type).toBeUndefined()
    expect(filter.script).toBeUndefined()
    expect(filter.requestId).toBeUndefined()
    expect(filter.doName).toBeUndefined()
    expect(filter.from).toBeUndefined()
    expect(filter.to).toBeUndefined()
  })

  it('should define ObsFilter with level constraint', () => {
    const filter: ObsFilter = {
      level: 'error',
    }

    expect(filter.level).toBe('error')
  })

  it('should define ObsFilter with type constraint', () => {
    const filter: ObsFilter = {
      type: 'exception',
    }

    expect(filter.type).toBe('exception')
  })

  it('should define ObsFilter with all fields populated', () => {
    const filter: ObsFilter = {
      level: 'warn',
      type: 'log',
      script: 'api-worker',
      requestId: 'req-abc123',
      doName: 'UserDO',
      from: 1704067200000, // 2024-01-01T00:00:00Z
      to: 1704153600000, // 2024-01-02T00:00:00Z
    }

    expect(filter.level).toBe('warn')
    expect(filter.type).toBe('log')
    expect(filter.script).toBe('api-worker')
    expect(filter.requestId).toBe('req-abc123')
    expect(filter.doName).toBe('UserDO')
    expect(filter.from).toBe(1704067200000)
    expect(filter.to).toBe(1704153600000)
  })
})

// ============================================================================
// ObservabilityEvent Type Tests
// ============================================================================

describe('ObservabilityEvent Type Definition', () => {
  it('should define ObservabilityEvent interface', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000, // 2024-01-01T12:00:00Z
      level: 'info',
      type: 'log',
      message: 'Request received',
      script: 'api-worker',
      requestId: 'req-xyz789',
    }

    expect(event.timestamp).toBe(1704110400000)
    expect(event.level).toBe('info')
    expect(event.type).toBe('log')
    expect(event.message).toBe('Request received')
    expect(event.script).toBe('api-worker')
    expect(event.requestId).toBe('req-xyz789')
  })

  it('should allow optional doName for DO method events', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'debug',
      type: 'do_method',
      message: 'Method invoked',
      script: 'api-worker',
      requestId: 'req-xyz789',
      doName: 'SessionDO',
    }

    expect(event.doName).toBe('SessionDO')
  })
})

// ============================================================================
// Empty Filter Matching Tests
// ============================================================================

describe('matchesFilter - Empty Filter', () => {
  it('should match any event when filter is empty', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'log',
      message: 'Test message',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {}

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should match error events when filter is empty', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'error',
      type: 'exception',
      message: 'Something went wrong',
      script: 'api-worker',
      requestId: 'req-456',
    }

    const filter: ObsFilter = {}

    expect(matchesFilter(event, filter)).toBe(true)
  })
})

// ============================================================================
// Level Filter Tests
// ============================================================================

describe('matchesFilter - Level', () => {
  it('should match events with the specified level', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'error',
      type: 'log',
      message: 'Error occurred',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { level: 'error' }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude events with different level', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'log',
      message: 'Info message',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { level: 'error' }

    expect(matchesFilter(event, filter)).toBe(false)
  })

  it('should match debug level events', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'debug',
      type: 'log',
      message: 'Debug output',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { level: 'debug' }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should match warn level events', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'warn',
      type: 'log',
      message: 'Warning issued',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { level: 'warn' }

    expect(matchesFilter(event, filter)).toBe(true)
  })
})

// ============================================================================
// Type Filter Tests
// ============================================================================

describe('matchesFilter - Type', () => {
  it('should match events with the specified type', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'error',
      type: 'exception',
      message: 'Unhandled exception',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { type: 'exception' }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude events with different type', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'log',
      message: 'Regular log',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { type: 'exception' }

    expect(matchesFilter(event, filter)).toBe(false)
  })

  it('should match request type events', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'request',
      message: 'GET /api/users',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { type: 'request' }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should match do_method type events', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'debug',
      type: 'do_method',
      message: 'DO method called: getUser',
      script: 'api-worker',
      requestId: 'req-123',
      doName: 'UserDO',
    }

    const filter: ObsFilter = { type: 'do_method' }

    expect(matchesFilter(event, filter)).toBe(true)
  })
})

// ============================================================================
// Script Filter Tests
// ============================================================================

describe('matchesFilter - Script', () => {
  it('should match events with the specified script (exact match)', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'log',
      message: 'Log from api-worker',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { script: 'api-worker' }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude events with different script', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'log',
      message: 'Log from background-worker',
      script: 'background-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { script: 'api-worker' }

    expect(matchesFilter(event, filter)).toBe(false)
  })

  it('should perform exact string match for script', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'log',
      message: 'Log message',
      script: 'api-worker-v2',
      requestId: 'req-123',
    }

    const filter: ObsFilter = { script: 'api-worker' }

    // Should not match because 'api-worker-v2' !== 'api-worker'
    expect(matchesFilter(event, filter)).toBe(false)
  })
})

// ============================================================================
// RequestId Filter Tests
// ============================================================================

describe('matchesFilter - RequestId', () => {
  it('should match events with the specified requestId', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'log',
      message: 'Processing request',
      script: 'api-worker',
      requestId: 'req-abc123',
    }

    const filter: ObsFilter = { requestId: 'req-abc123' }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude events with different requestId', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'log',
      message: 'Processing request',
      script: 'api-worker',
      requestId: 'req-xyz789',
    }

    const filter: ObsFilter = { requestId: 'req-abc123' }

    expect(matchesFilter(event, filter)).toBe(false)
  })
})

// ============================================================================
// DoName Filter Tests
// ============================================================================

describe('matchesFilter - DoName', () => {
  it('should match events with the specified doName', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'debug',
      type: 'do_method',
      message: 'Method invoked',
      script: 'api-worker',
      requestId: 'req-123',
      doName: 'UserDO',
    }

    const filter: ObsFilter = { doName: 'UserDO' }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude events with different doName', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'debug',
      type: 'do_method',
      message: 'Method invoked',
      script: 'api-worker',
      requestId: 'req-123',
      doName: 'SessionDO',
    }

    const filter: ObsFilter = { doName: 'UserDO' }

    expect(matchesFilter(event, filter)).toBe(false)
  })

  it('should exclude events without doName when filter specifies doName', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info',
      type: 'log',
      message: 'Regular log',
      script: 'api-worker',
      requestId: 'req-123',
      // doName is undefined
    }

    const filter: ObsFilter = { doName: 'UserDO' }

    expect(matchesFilter(event, filter)).toBe(false)
  })
})

// ============================================================================
// Timestamp Range Filter Tests
// ============================================================================

describe('matchesFilter - Timestamp From', () => {
  it('should match events at or after the from timestamp', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000, // 2024-01-01T12:00:00Z
      level: 'info',
      type: 'log',
      message: 'Log message',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {
      from: 1704067200000, // 2024-01-01T00:00:00Z
    }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should match events exactly at the from timestamp', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704067200000, // Exact match
      level: 'info',
      type: 'log',
      message: 'Log message',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {
      from: 1704067200000,
    }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude events before the from timestamp', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704020000000, // 2024-01-01T00:00:00Z - 47200 seconds (before from)
      level: 'info',
      type: 'log',
      message: 'Old log message',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {
      from: 1704067200000, // 2024-01-01T00:00:00Z
    }

    expect(matchesFilter(event, filter)).toBe(false)
  })
})

describe('matchesFilter - Timestamp To', () => {
  it('should match events at or before the to timestamp', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000, // 2024-01-01T12:00:00Z
      level: 'info',
      type: 'log',
      message: 'Log message',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {
      to: 1704153600000, // 2024-01-02T00:00:00Z
    }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should match events exactly at the to timestamp', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704153600000, // Exact match
      level: 'info',
      type: 'log',
      message: 'Log message',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {
      to: 1704153600000,
    }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude events after the to timestamp', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704200000000, // After to timestamp
      level: 'info',
      type: 'log',
      message: 'Future log message',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {
      to: 1704153600000, // 2024-01-02T00:00:00Z
    }

    expect(matchesFilter(event, filter)).toBe(false)
  })
})

describe('matchesFilter - Timestamp Range (from AND to)', () => {
  it('should match events within the time range', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000, // 2024-01-01T12:00:00Z (within range)
      level: 'info',
      type: 'log',
      message: 'Log message',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {
      from: 1704067200000, // 2024-01-01T00:00:00Z
      to: 1704153600000, // 2024-01-02T00:00:00Z
    }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude events before the range', () => {
    const event: ObservabilityEvent = {
      timestamp: 1703980800000, // 2023-12-31T00:00:00Z (before range)
      level: 'info',
      type: 'log',
      message: 'Old log',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {
      from: 1704067200000, // 2024-01-01T00:00:00Z
      to: 1704153600000, // 2024-01-02T00:00:00Z
    }

    expect(matchesFilter(event, filter)).toBe(false)
  })

  it('should exclude events after the range', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704240000000, // 2024-01-03T00:00:00Z (after range)
      level: 'info',
      type: 'log',
      message: 'Future log',
      script: 'api-worker',
      requestId: 'req-123',
    }

    const filter: ObsFilter = {
      from: 1704067200000, // 2024-01-01T00:00:00Z
      to: 1704153600000, // 2024-01-02T00:00:00Z
    }

    expect(matchesFilter(event, filter)).toBe(false)
  })
})

// ============================================================================
// Multiple Filter Fields (AND Logic) Tests
// ============================================================================

describe('matchesFilter - Multiple Fields (AND logic)', () => {
  it('should match when all filter fields match', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'error',
      type: 'exception',
      message: 'Unhandled error',
      script: 'api-worker',
      requestId: 'req-abc123',
      doName: 'UserDO',
    }

    const filter: ObsFilter = {
      level: 'error',
      type: 'exception',
      script: 'api-worker',
    }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude when first filter field does not match', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'info', // Does not match 'error'
      type: 'exception',
      message: 'Unhandled error',
      script: 'api-worker',
      requestId: 'req-abc123',
    }

    const filter: ObsFilter = {
      level: 'error',
      type: 'exception',
      script: 'api-worker',
    }

    expect(matchesFilter(event, filter)).toBe(false)
  })

  it('should exclude when second filter field does not match', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'error',
      type: 'log', // Does not match 'exception'
      message: 'Error log',
      script: 'api-worker',
      requestId: 'req-abc123',
    }

    const filter: ObsFilter = {
      level: 'error',
      type: 'exception',
      script: 'api-worker',
    }

    expect(matchesFilter(event, filter)).toBe(false)
  })

  it('should exclude when third filter field does not match', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'error',
      type: 'exception',
      message: 'Unhandled error',
      script: 'background-worker', // Does not match 'api-worker'
      requestId: 'req-abc123',
    }

    const filter: ObsFilter = {
      level: 'error',
      type: 'exception',
      script: 'api-worker',
    }

    expect(matchesFilter(event, filter)).toBe(false)
  })

  it('should work with all filter fields combined', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000, // Within time range
      level: 'error',
      type: 'exception',
      message: 'Unhandled error',
      script: 'api-worker',
      requestId: 'req-abc123',
      doName: 'UserDO',
    }

    const filter: ObsFilter = {
      level: 'error',
      type: 'exception',
      script: 'api-worker',
      requestId: 'req-abc123',
      doName: 'UserDO',
      from: 1704067200000, // 2024-01-01T00:00:00Z
      to: 1704153600000, // 2024-01-02T00:00:00Z
    }

    expect(matchesFilter(event, filter)).toBe(true)
  })

  it('should exclude when any field in comprehensive filter does not match', () => {
    const event: ObservabilityEvent = {
      timestamp: 1704110400000,
      level: 'error',
      type: 'exception',
      message: 'Unhandled error',
      script: 'api-worker',
      requestId: 'req-abc123',
      doName: 'SessionDO', // Does not match 'UserDO'
    }

    const filter: ObsFilter = {
      level: 'error',
      type: 'exception',
      script: 'api-worker',
      requestId: 'req-abc123',
      doName: 'UserDO', // Mismatch
      from: 1704067200000,
      to: 1704153600000,
    }

    expect(matchesFilter(event, filter)).toBe(false)
  })
})

// ============================================================================
// Filter Validation Tests
// ============================================================================

describe('validateObsFilter', () => {
  it('should accept valid empty filter', () => {
    const result = validateObsFilter({})

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should accept valid filter with level', () => {
    const result = validateObsFilter({ level: 'error' })

    expect(result.success).toBe(true)
  })

  it('should accept valid filter with type', () => {
    const result = validateObsFilter({ type: 'exception' })

    expect(result.success).toBe(true)
  })

  it('should accept valid filter with all fields', () => {
    const result = validateObsFilter({
      level: 'warn',
      type: 'log',
      script: 'api-worker',
      requestId: 'req-123',
      doName: 'UserDO',
      from: 1704067200000,
      to: 1704153600000,
    })

    expect(result.success).toBe(true)
  })

  it('should reject filter with invalid level value', () => {
    const result = validateObsFilter({
      level: 'invalid-level' as 'error',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'level' })
    )
  })

  it('should reject filter with invalid type value', () => {
    const result = validateObsFilter({
      type: 'invalid-type' as 'log',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'type' })
    )
  })

  it('should reject filter with unknown field', () => {
    const result = validateObsFilter({
      level: 'error',
      unknownField: 'value',
    } as ObsFilter)

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'unknownField' })
    )
  })

  it('should reject filter with from > to (invalid time range)', () => {
    const result = validateObsFilter({
      from: 1704153600000, // 2024-01-02T00:00:00Z
      to: 1704067200000, // 2024-01-01T00:00:00Z (before from)
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'from',
        message: expect.stringContaining('from'),
      })
    )
  })

  it('should accept filter where from equals to (point in time)', () => {
    const result = validateObsFilter({
      from: 1704067200000,
      to: 1704067200000, // Same timestamp
    })

    expect(result.success).toBe(true)
  })

  it('should reject filter with non-number from timestamp', () => {
    const result = validateObsFilter({
      from: 'not-a-number' as unknown as number,
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'from' })
    )
  })

  it('should reject filter with non-number to timestamp', () => {
    const result = validateObsFilter({
      to: 'not-a-number' as unknown as number,
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'to' })
    )
  })

  it('should reject filter with negative timestamp', () => {
    const result = validateObsFilter({
      from: -1000,
    })

    expect(result.success).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'from' })
    )
  })
})

// ============================================================================
// ObsFilterSchema (Zod) Tests
// ============================================================================

describe('ObsFilterSchema', () => {
  it('should export ObsFilterSchema for runtime validation', () => {
    expect(ObsFilterSchema).toBeDefined()
  })

  it('should parse valid filter', () => {
    const result = ObsFilterSchema.safeParse({
      level: 'error',
      type: 'exception',
    })

    expect(result.success).toBe(true)
  })

  it('should parse empty filter', () => {
    const result = ObsFilterSchema.safeParse({})

    expect(result.success).toBe(true)
  })

  it('should reject invalid level', () => {
    const result = ObsFilterSchema.safeParse({
      level: 'invalid',
    })

    expect(result.success).toBe(false)
  })

  it('should reject invalid type', () => {
    const result = ObsFilterSchema.safeParse({
      type: 'invalid',
    })

    expect(result.success).toBe(false)
  })

  it('should reject unknown fields (strict mode)', () => {
    const result = ObsFilterSchema.safeParse({
      level: 'error',
      unknownField: 'value',
    })

    expect(result.success).toBe(false)
  })
})
