import { describe, it, expect } from 'vitest'

/**
 * Tail Worker Event Processing Tests (RED Phase)
 *
 * These tests verify the processTailEvents function that converts
 * Cloudflare TailItem[] to ObservabilityEvent[].
 *
 * Implementation requirements:
 * - Create workers/observability-tail/process.ts with processTailEvents function
 * - Convert TailItem logs to log ObservabilityEvents
 * - Convert TailItem exceptions to exception ObservabilityEvents
 * - Convert TailItem request/response to request ObservabilityEvents
 * - Extract requestId from x-request-id header
 * - Map log levels correctly (log -> info)
 *
 * This is the RED phase of TDD - tests should fail because the
 * implementation doesn't exist yet.
 */

// This import should fail until the implementation exists
import { processTailEvents } from '../../workers/observability-tail/process'
import type { ObservabilityEvent } from '../../types/observability'

// ============================================================================
// TailItem Mock Type Definition (mirrors Cloudflare's TailItem)
// ============================================================================

interface TailItem {
  scriptName: string
  eventTimestamp: number
  outcome: 'ok' | 'exception' | 'exceededCpu' | 'exceededMemory' | 'canceled' | 'unknown'
  event: {
    request: {
      url: string
      method: string
      headers: Record<string, string>
    }
    response?: {
      status: number
    }
  }
  logs: Array<{
    level: 'debug' | 'info' | 'log' | 'warn' | 'error'
    message: any[]
    timestamp: number
  }>
  exceptions: Array<{
    name: string
    message: string
    stack?: string
  }>
}

// ============================================================================
// Helper Functions for Creating Mock TailItems
// ============================================================================

function createMockTailItem(overrides: Partial<TailItem> = {}): TailItem {
  return {
    scriptName: 'api-worker',
    eventTimestamp: Date.now(),
    outcome: 'ok',
    event: {
      request: {
        url: 'https://api.example.com.ai/users',
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-abc123',
        },
      },
      response: {
        status: 200,
      },
    },
    logs: [],
    exceptions: [],
    ...overrides,
  }
}

// ============================================================================
// Test: Process TailItem with logs -> creates log ObservabilityEvents
// ============================================================================

describe('processTailEvents - Log Processing', () => {
  it('should convert TailItem with logs to log ObservabilityEvents', () => {
    const tailItem = createMockTailItem({
      logs: [
        {
          level: 'info',
          message: ['User logged in', { userId: 'user-123' }],
          timestamp: 1704067200000,
        },
        {
          level: 'warn',
          message: ['Rate limit approaching'],
          timestamp: 1704067201000,
        },
      ],
    })

    const events = processTailEvents([tailItem])

    // Should create at least 2 log events (plus potentially a request event)
    const logEvents = events.filter((e) => e.type === 'log')
    expect(logEvents).toHaveLength(2)

    // First log event
    expect(logEvents[0].type).toBe('log')
    expect(logEvents[0].level).toBe('info')
    expect(logEvents[0].script).toBe('api-worker')
    expect(logEvents[0].timestamp).toBe(1704067200000)
    expect(logEvents[0].message).toContain('User logged in')

    // Second log event
    expect(logEvents[1].type).toBe('log')
    expect(logEvents[1].level).toBe('warn')
    expect(logEvents[1].timestamp).toBe(1704067201000)
  })

  it('should map log.level "log" to "info" level', () => {
    const tailItem = createMockTailItem({
      logs: [
        {
          level: 'log', // Cloudflare uses 'log' which should map to 'info'
          message: ['Generic log message'],
          timestamp: 1704067200000,
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const logEvents = events.filter((e) => e.type === 'log')

    expect(logEvents).toHaveLength(1)
    expect(logEvents[0].level).toBe('info') // Should be mapped to 'info'
  })

  it('should preserve debug level correctly', () => {
    const tailItem = createMockTailItem({
      logs: [
        {
          level: 'debug',
          message: ['Debug trace'],
          timestamp: 1704067200000,
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const logEvents = events.filter((e) => e.type === 'log')

    expect(logEvents[0].level).toBe('debug')
  })

  it('should preserve error level correctly', () => {
    const tailItem = createMockTailItem({
      logs: [
        {
          level: 'error',
          message: ['Something went wrong'],
          timestamp: 1704067200000,
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const logEvents = events.filter((e) => e.type === 'log')

    expect(logEvents[0].level).toBe('error')
  })

  it('should preserve warn level correctly', () => {
    const tailItem = createMockTailItem({
      logs: [
        {
          level: 'warn',
          message: ['Warning message'],
          timestamp: 1704067200000,
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const logEvents = events.filter((e) => e.type === 'log')

    expect(logEvents[0].level).toBe('warn')
  })
})

// ============================================================================
// Test: Process TailItem with exceptions -> creates exception ObservabilityEvents
// ============================================================================

describe('processTailEvents - Exception Processing', () => {
  it('should convert TailItem with exceptions to exception ObservabilityEvents', () => {
    const tailItem = createMockTailItem({
      outcome: 'exception',
      exceptions: [
        {
          name: 'TypeError',
          message: "Cannot read property 'id' of undefined",
          stack:
            "TypeError: Cannot read property 'id' of undefined\n    at handler (/src/index.ts:42:10)\n    at processRequest (/src/router.ts:15:5)",
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const exceptionEvents = events.filter((e) => e.type === 'exception')

    expect(exceptionEvents).toHaveLength(1)
    expect(exceptionEvents[0].type).toBe('exception')
    expect(exceptionEvents[0].level).toBe('error')
    expect(exceptionEvents[0].script).toBe('api-worker')
    expect(exceptionEvents[0].message).toContain("Cannot read property 'id' of undefined")
  })

  it('should extract stack trace from exceptions', () => {
    const stackTrace =
      "Error: Database connection failed\n    at connect (/src/db.ts:12:5)\n    at init (/src/app.ts:8:3)"
    const tailItem = createMockTailItem({
      outcome: 'exception',
      exceptions: [
        {
          name: 'Error',
          message: 'Database connection failed',
          stack: stackTrace,
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const exceptionEvents = events.filter((e) => e.type === 'exception')

    expect(exceptionEvents[0].stack).toBe(stackTrace)
  })

  it('should handle exceptions without stack trace', () => {
    const tailItem = createMockTailItem({
      outcome: 'exception',
      exceptions: [
        {
          name: 'ValidationError',
          message: 'Invalid input data',
          // No stack trace
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const exceptionEvents = events.filter((e) => e.type === 'exception')

    expect(exceptionEvents).toHaveLength(1)
    expect(exceptionEvents[0].stack).toBeUndefined()
  })

  it('should handle multiple exceptions in a single TailItem', () => {
    const tailItem = createMockTailItem({
      outcome: 'exception',
      exceptions: [
        {
          name: 'Error',
          message: 'First error',
        },
        {
          name: 'Error',
          message: 'Second error (caught from first)',
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const exceptionEvents = events.filter((e) => e.type === 'exception')

    expect(exceptionEvents).toHaveLength(2)
    expect(exceptionEvents[0].message).toContain('First error')
    expect(exceptionEvents[1].message).toContain('Second error')
  })
})

// ============================================================================
// Test: Process TailItem with request/response -> creates request ObservabilityEvent
// ============================================================================

describe('processTailEvents - Request Processing', () => {
  it('should convert TailItem with request/response to request ObservabilityEvent', () => {
    const tailItem = createMockTailItem({
      eventTimestamp: 1704067200000,
      event: {
        request: {
          url: 'https://api.example.com.ai/users/123',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req-xyz789',
          },
        },
        response: {
          status: 201,
        },
      },
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents).toHaveLength(1)
    expect(requestEvents[0].type).toBe('request')
    expect(requestEvents[0].level).toBe('info')
    expect(requestEvents[0].script).toBe('api-worker')
    expect(requestEvents[0].method).toBe('POST')
    expect(requestEvents[0].url).toBe('https://api.example.com.ai/users/123')
    expect(requestEvents[0].status).toBe(201)
    expect(requestEvents[0].requestId).toBe('req-xyz789')
  })

  it('should extract requestId from x-request-id header', () => {
    const tailItem = createMockTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/test',
          method: 'GET',
          headers: {
            'x-request-id': 'custom-request-id-12345',
          },
        },
        response: { status: 200 },
      },
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents[0].requestId).toBe('custom-request-id-12345')
  })

  it('should extract requestId from X-Request-ID header (case-insensitive)', () => {
    const tailItem = createMockTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/test',
          method: 'GET',
          headers: {
            'X-Request-ID': 'uppercase-request-id',
          },
        },
        response: { status: 200 },
      },
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents[0].requestId).toBe('uppercase-request-id')
  })

  it('should handle missing requestId gracefully', () => {
    const tailItem = createMockTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/test',
          method: 'GET',
          headers: {
            // No x-request-id header
            'content-type': 'application/json',
          },
        },
        response: { status: 200 },
      },
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents).toHaveLength(1)
    // requestId should be undefined or a generated value, not crash
    expect(requestEvents[0].requestId).toBeDefined()
  })

  it('should handle TailItem with no response', () => {
    const tailItem = createMockTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/test',
          method: 'GET',
          headers: {
            'x-request-id': 'req-no-response',
          },
        },
        // No response object
      },
    })

    // Remove the response property
    delete (tailItem.event as any).response

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents).toHaveLength(1)
    expect(requestEvents[0].status).toBeUndefined()
    expect(requestEvents[0].method).toBe('GET')
    expect(requestEvents[0].url).toBe('https://api.example.com.ai/test')
  })

  it('should set level to error for 5xx status codes', () => {
    const tailItem = createMockTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/error',
          method: 'GET',
          headers: {},
        },
        response: { status: 500 },
      },
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents[0].level).toBe('error')
    expect(requestEvents[0].status).toBe(500)
  })

  it('should set level to warn for 4xx status codes', () => {
    const tailItem = createMockTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/not-found',
          method: 'GET',
          headers: {},
        },
        response: { status: 404 },
      },
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents[0].level).toBe('warn')
    expect(requestEvents[0].status).toBe(404)
  })
})

// ============================================================================
// Test: Handle TailItem with no logs
// ============================================================================

describe('processTailEvents - Empty Logs', () => {
  it('should handle TailItem with no logs', () => {
    const tailItem = createMockTailItem({
      logs: [],
    })

    const events = processTailEvents([tailItem])
    const logEvents = events.filter((e) => e.type === 'log')

    expect(logEvents).toHaveLength(0)
    // Should still have a request event
    const requestEvents = events.filter((e) => e.type === 'request')
    expect(requestEvents).toHaveLength(1)
  })

  it('should handle TailItem with empty logs array and no exceptions', () => {
    const tailItem = createMockTailItem({
      logs: [],
      exceptions: [],
    })

    const events = processTailEvents([tailItem])

    // Should only create request event
    expect(events.length).toBe(1)
    expect(events[0].type).toBe('request')
  })
})

// ============================================================================
// Test: Batch multiple events from single TailItem
// ============================================================================

describe('processTailEvents - Batching', () => {
  it('should batch multiple events from single TailItem', () => {
    const tailItem = createMockTailItem({
      logs: [
        { level: 'info', message: ['Log 1'], timestamp: 1704067200000 },
        { level: 'info', message: ['Log 2'], timestamp: 1704067201000 },
        { level: 'warn', message: ['Log 3'], timestamp: 1704067202000 },
      ],
      exceptions: [
        {
          name: 'Error',
          message: 'An error occurred',
          stack: 'Error: An error occurred',
        },
      ],
    })

    const events = processTailEvents([tailItem])

    // Should have: 3 logs + 1 exception + 1 request = 5 events
    expect(events.length).toBe(5)

    const logEvents = events.filter((e) => e.type === 'log')
    const exceptionEvents = events.filter((e) => e.type === 'exception')
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(logEvents).toHaveLength(3)
    expect(exceptionEvents).toHaveLength(1)
    expect(requestEvents).toHaveLength(1)
  })

  it('should process multiple TailItems', () => {
    const tailItems = [
      createMockTailItem({
        scriptName: 'worker-1',
        logs: [{ level: 'info', message: ['From worker 1'], timestamp: 1704067200000 }],
      }),
      createMockTailItem({
        scriptName: 'worker-2',
        logs: [{ level: 'debug', message: ['From worker 2'], timestamp: 1704067201000 }],
      }),
    ]

    const events = processTailEvents(tailItems)

    // Each TailItem should produce logs and request events
    const logEvents = events.filter((e) => e.type === 'log')
    expect(logEvents).toHaveLength(2)
    expect(logEvents[0].script).toBe('worker-1')
    expect(logEvents[1].script).toBe('worker-2')

    const requestEvents = events.filter((e) => e.type === 'request')
    expect(requestEvents).toHaveLength(2)
  })

  it('should preserve order of events within a TailItem', () => {
    const tailItem = createMockTailItem({
      logs: [
        { level: 'info', message: ['First'], timestamp: 1704067200000 },
        { level: 'info', message: ['Second'], timestamp: 1704067201000 },
        { level: 'info', message: ['Third'], timestamp: 1704067202000 },
      ],
    })

    const events = processTailEvents([tailItem])
    const logEvents = events.filter((e) => e.type === 'log')

    expect(logEvents[0].timestamp).toBe(1704067200000)
    expect(logEvents[1].timestamp).toBe(1704067201000)
    expect(logEvents[2].timestamp).toBe(1704067202000)
  })
})

// ============================================================================
// Test: All ObservabilityEvents should have valid UUIDs
// ============================================================================

describe('processTailEvents - Event ID Generation', () => {
  it('should generate valid UUIDs for all events', () => {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    const tailItem = createMockTailItem({
      logs: [{ level: 'info', message: ['Test'], timestamp: 1704067200000 }],
      exceptions: [{ name: 'Error', message: 'Test error' }],
    })

    const events = processTailEvents([tailItem])

    for (const event of events) {
      expect(event.id).toMatch(uuidRegex)
    }
  })

  it('should generate unique IDs for each event', () => {
    const tailItem = createMockTailItem({
      logs: [
        { level: 'info', message: ['Log 1'], timestamp: 1704067200000 },
        { level: 'info', message: ['Log 2'], timestamp: 1704067201000 },
      ],
    })

    const events = processTailEvents([tailItem])
    const ids = events.map((e) => e.id)
    const uniqueIds = new Set(ids)

    expect(uniqueIds.size).toBe(ids.length)
  })
})

// ============================================================================
// Test: All events should share requestId when available
// ============================================================================

describe('processTailEvents - Request ID Correlation', () => {
  it('should attach requestId to all events from same TailItem', () => {
    const tailItem = createMockTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/test',
          method: 'GET',
          headers: {
            'x-request-id': 'shared-request-id',
          },
        },
        response: { status: 200 },
      },
      logs: [
        { level: 'info', message: ['Log entry'], timestamp: 1704067200000 },
      ],
      exceptions: [{ name: 'Error', message: 'Exception' }],
    })

    const events = processTailEvents([tailItem])

    // All events should have the same requestId for correlation
    for (const event of events) {
      expect(event.requestId).toBe('shared-request-id')
    }
  })
})

// ============================================================================
// Test: Message array serialization
// ============================================================================

describe('processTailEvents - Message Serialization', () => {
  it('should serialize complex message objects to strings', () => {
    const tailItem = createMockTailItem({
      logs: [
        {
          level: 'info',
          message: ['User action:', { userId: 123, action: 'click' }],
          timestamp: 1704067200000,
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const logEvents = events.filter((e) => e.type === 'log')

    // Message should be converted to string array
    expect(logEvents[0].message).toBeDefined()
    expect(Array.isArray(logEvents[0].message)).toBe(true)
    // Complex objects should be serialized
    expect(logEvents[0].message).toContainEqual(expect.any(String))
  })

  it('should handle primitive message values', () => {
    const tailItem = createMockTailItem({
      logs: [
        {
          level: 'info',
          message: ['Count:', 42, true, null],
          timestamp: 1704067200000,
        },
      ],
    })

    const events = processTailEvents([tailItem])
    const logEvents = events.filter((e) => e.type === 'log')

    expect(logEvents[0].message).toBeDefined()
  })
})

// ============================================================================
// Test: Outcome handling
// ============================================================================

describe('processTailEvents - Outcome Handling', () => {
  it('should handle exceededCpu outcome', () => {
    const tailItem = createMockTailItem({
      outcome: 'exceededCpu',
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    // Request event should indicate CPU exceeded (could be in level or metadata)
    expect(requestEvents).toHaveLength(1)
    // Implementation could set level to error or add metadata
    expect(
      requestEvents[0].level === 'error' ||
        requestEvents[0].metadata?.outcome === 'exceededCpu'
    ).toBe(true)
  })

  it('should handle exceededMemory outcome', () => {
    const tailItem = createMockTailItem({
      outcome: 'exceededMemory',
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents).toHaveLength(1)
    expect(
      requestEvents[0].level === 'error' ||
        requestEvents[0].metadata?.outcome === 'exceededMemory'
    ).toBe(true)
  })

  it('should handle canceled outcome', () => {
    const tailItem = createMockTailItem({
      outcome: 'canceled',
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents).toHaveLength(1)
  })

  it('should handle unknown outcome', () => {
    const tailItem = createMockTailItem({
      outcome: 'unknown',
    })

    const events = processTailEvents([tailItem])
    const requestEvents = events.filter((e) => e.type === 'request')

    expect(requestEvents).toHaveLength(1)
  })
})

// ============================================================================
// Test: Empty input handling
// ============================================================================

describe('processTailEvents - Edge Cases', () => {
  it('should return empty array for empty input', () => {
    const events = processTailEvents([])

    expect(events).toEqual([])
  })

  it('should handle null/undefined message items gracefully', () => {
    const tailItem = createMockTailItem({
      logs: [
        {
          level: 'info',
          message: [null, undefined, 'valid message'],
          timestamp: 1704067200000,
        },
      ],
    })

    // Should not throw
    const events = processTailEvents([tailItem])
    expect(events.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Type validation: Ensure output matches ObservabilityEvent
// ============================================================================

describe('processTailEvents - Type Validation', () => {
  it('should produce events that match ObservabilityEvent type', () => {
    const tailItem = createMockTailItem({
      logs: [{ level: 'info', message: ['Test'], timestamp: 1704067200000 }],
    })

    const events: ObservabilityEvent[] = processTailEvents([tailItem])

    // Type assertion passes if events match ObservabilityEvent[]
    expect(Array.isArray(events)).toBe(true)
    for (const event of events) {
      // Required fields
      expect(typeof event.id).toBe('string')
      expect(['log', 'exception', 'request', 'do_method']).toContain(event.type)
      expect(['debug', 'info', 'warn', 'error']).toContain(event.level)
      expect(typeof event.script).toBe('string')
      expect(typeof event.timestamp).toBe('number')
    }
  })
})
