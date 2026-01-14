/**
 * Tail Event Processing Tests
 *
 * Tests for converting TailItem[] to ObservabilityEvent[].
 * Covers log processing, exception handling, and request event creation.
 *
 * @module workers/observability-tail/process.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { processTailEvents, type TailItem } from './process'
import type { ObservabilityEvent } from '../../types/observability'

// ============================================================================
// Test Fixtures
// ============================================================================

function createTailItem(overrides: Partial<TailItem> = {}): TailItem {
  return {
    scriptName: overrides.scriptName ?? 'test-worker',
    eventTimestamp: overrides.eventTimestamp ?? 1704067200000,
    outcome: overrides.outcome ?? 'ok',
    event: overrides.event ?? {
      request: {
        url: 'https://api.example.com.ai/test',
        method: 'GET',
        headers: {},
      },
      response: {
        status: 200,
      },
    },
    logs: overrides.logs ?? [],
    exceptions: overrides.exceptions ?? [],
  }
}

function createLogEntry(overrides: Partial<TailItem['logs'][0]> = {}): TailItem['logs'][0] {
  return {
    level: overrides.level ?? 'info',
    message: overrides.message ?? ['Test log message'],
    timestamp: overrides.timestamp ?? 1704067200000,
  }
}

function createException(overrides: Partial<TailItem['exceptions'][0]> = {}): TailItem['exceptions'][0] {
  return {
    name: overrides.name ?? 'Error',
    message: overrides.message ?? 'Test error',
    stack: overrides.stack,
  }
}

// ============================================================================
// Mock crypto.randomUUID
// ============================================================================

beforeEach(() => {
  let uuidCounter = 0
  vi.stubGlobal('crypto', {
    randomUUID: () => `uuid-${++uuidCounter}`,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ============================================================================
// Basic Processing Tests
// ============================================================================

describe('processTailEvents', () => {
  describe('Basic Processing', () => {
    it('returns empty array for empty input', () => {
      const result = processTailEvents([])
      expect(result).toEqual([])
    })

    it('creates request event for each tail item', () => {
      const tailItems = [createTailItem()]
      const result = processTailEvents(tailItems)

      const requestEvents = result.filter(e => e.type === 'request')
      expect(requestEvents).toHaveLength(1)
    })

    it('processes multiple tail items', () => {
      const tailItems = [
        createTailItem({ scriptName: 'worker-1' }),
        createTailItem({ scriptName: 'worker-2' }),
        createTailItem({ scriptName: 'worker-3' }),
      ]
      const result = processTailEvents(tailItems)

      const requestEvents = result.filter(e => e.type === 'request')
      expect(requestEvents).toHaveLength(3)
    })
  })

  describe('Request Event Creation', () => {
    it('includes script name', () => {
      const tailItems = [createTailItem({ scriptName: 'my-worker' })]
      const result = processTailEvents(tailItems)

      const requestEvent = result.find(e => e.type === 'request')
      expect(requestEvent?.script).toBe('my-worker')
    })

    it('includes timestamp', () => {
      const tailItems = [createTailItem({ eventTimestamp: 1704153600000 })]
      const result = processTailEvents(tailItems)

      const requestEvent = result.find(e => e.type === 'request')
      expect(requestEvent?.timestamp).toBe(1704153600000)
    })

    it('includes method', () => {
      const tailItems = [createTailItem({
        event: {
          request: { url: 'https://api.example.com.ai/', method: 'POST', headers: {} },
          response: { status: 201 },
        },
      })]
      const result = processTailEvents(tailItems)

      const requestEvent = result.find(e => e.type === 'request')
      expect(requestEvent?.method).toBe('POST')
    })

    it('includes URL', () => {
      const tailItems = [createTailItem({
        event: {
          request: { url: 'https://api.example.com.ai/users/123', method: 'GET', headers: {} },
        },
      })]
      const result = processTailEvents(tailItems)

      const requestEvent = result.find(e => e.type === 'request')
      expect(requestEvent?.url).toBe('https://api.example.com.ai/users/123')
    })

    it('includes status code', () => {
      const tailItems = [createTailItem({
        event: {
          request: { url: 'https://api.example.com.ai/', method: 'GET', headers: {} },
          response: { status: 404 },
        },
      })]
      const result = processTailEvents(tailItems)

      const requestEvent = result.find(e => e.type === 'request')
      expect(requestEvent?.status).toBe(404)
    })

    it('generates unique ID for each event', () => {
      const tailItems = [createTailItem(), createTailItem()]
      const result = processTailEvents(tailItems)

      const ids = result.map(e => e.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})

// ============================================================================
// Level Determination Tests
// ============================================================================

describe('Request Level Determination', () => {
  it('sets info level for 2xx responses', () => {
    const tailItems = [createTailItem({
      event: {
        request: { url: 'https://api.example.com.ai/', method: 'GET', headers: {} },
        response: { status: 200 },
      },
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.level).toBe('info')
  })

  it('sets info level for 201 Created', () => {
    const tailItems = [createTailItem({
      event: {
        request: { url: 'https://api.example.com.ai/', method: 'POST', headers: {} },
        response: { status: 201 },
      },
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.level).toBe('info')
  })

  it('sets warn level for 4xx responses', () => {
    const tailItems = [createTailItem({
      event: {
        request: { url: 'https://api.example.com.ai/', method: 'GET', headers: {} },
        response: { status: 400 },
      },
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.level).toBe('warn')
  })

  it('sets warn level for 404 Not Found', () => {
    const tailItems = [createTailItem({
      event: {
        request: { url: 'https://api.example.com.ai/', method: 'GET', headers: {} },
        response: { status: 404 },
      },
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.level).toBe('warn')
  })

  it('sets error level for 5xx responses', () => {
    const tailItems = [createTailItem({
      event: {
        request: { url: 'https://api.example.com.ai/', method: 'GET', headers: {} },
        response: { status: 500 },
      },
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.level).toBe('error')
  })

  it('sets error level for 503 Service Unavailable', () => {
    const tailItems = [createTailItem({
      event: {
        request: { url: 'https://api.example.com.ai/', method: 'GET', headers: {} },
        response: { status: 503 },
      },
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.level).toBe('error')
  })

  it('sets error level for exception outcome', () => {
    const tailItems = [createTailItem({
      outcome: 'exception',
      event: {
        request: { url: 'https://api.example.com.ai/', method: 'GET', headers: {} },
        response: { status: 200 },
      },
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.level).toBe('error')
  })

  it('sets error level for exceededCpu outcome', () => {
    const tailItems = [createTailItem({
      outcome: 'exceededCpu',
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.level).toBe('error')
  })

  it('sets error level for exceededMemory outcome', () => {
    const tailItems = [createTailItem({
      outcome: 'exceededMemory',
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.level).toBe('error')
  })
})

// ============================================================================
// Log Processing Tests
// ============================================================================

describe('Log Processing', () => {
  it('creates log event for each log entry', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ message: ['Log 1'] }),
        createLogEntry({ message: ['Log 2'] }),
        createLogEntry({ message: ['Log 3'] }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvents = result.filter(e => e.type === 'log')
    expect(logEvents).toHaveLength(3)
  })

  it('preserves log level', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ level: 'debug', message: ['Debug message'] }),
        createLogEntry({ level: 'info', message: ['Info message'] }),
        createLogEntry({ level: 'warn', message: ['Warn message'] }),
        createLogEntry({ level: 'error', message: ['Error message'] }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvents = result.filter(e => e.type === 'log')
    expect(logEvents[0].level).toBe('debug')
    expect(logEvents[1].level).toBe('info')
    expect(logEvents[2].level).toBe('warn')
    expect(logEvents[3].level).toBe('error')
  })

  it('maps "log" level to "info"', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ level: 'log', message: ['Console.log message'] }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.level).toBe('info')
  })

  it('preserves log timestamp', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ timestamp: 1704153600000 }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.timestamp).toBe(1704153600000)
  })

  it('serializes string messages', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ message: ['Hello', 'World'] }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.message).toEqual(['Hello', 'World'])
  })

  it('serializes number messages', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ message: [42, 3.14, -1] }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.message).toEqual(['42', '3.14', '-1'])
  })

  it('serializes boolean messages', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ message: [true, false] }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.message).toEqual(['true', 'false'])
  })

  it('serializes null and undefined', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ message: [null, undefined] }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.message).toEqual(['null', 'undefined'])
  })

  it('serializes objects to JSON', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ message: [{ foo: 'bar', count: 42 }] }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.message).toEqual(['{"foo":"bar","count":42}'])
  })

  it('serializes arrays to JSON', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ message: [[1, 2, 3]] }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.message).toEqual(['[1,2,3]'])
  })
})

// ============================================================================
// Exception Processing Tests
// ============================================================================

describe('Exception Processing', () => {
  it('creates exception event for each exception', () => {
    const tailItems = [createTailItem({
      exceptions: [
        createException({ message: 'Error 1' }),
        createException({ message: 'Error 2' }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const exceptionEvents = result.filter(e => e.type === 'exception')
    expect(exceptionEvents).toHaveLength(2)
  })

  it('sets exception level to error', () => {
    const tailItems = [createTailItem({
      exceptions: [createException()],
    })]
    const result = processTailEvents(tailItems)

    const exceptionEvent = result.find(e => e.type === 'exception')
    expect(exceptionEvent?.level).toBe('error')
  })

  it('includes exception message', () => {
    const tailItems = [createTailItem({
      exceptions: [createException({ message: 'Connection timeout' })],
    })]
    const result = processTailEvents(tailItems)

    const exceptionEvent = result.find(e => e.type === 'exception')
    expect(exceptionEvent?.message).toContain('Connection timeout')
  })

  it('includes exception stack trace', () => {
    const stack = 'Error: Test\n    at test.js:10:5\n    at main.js:20:3'
    const tailItems = [createTailItem({
      exceptions: [createException({ stack })],
    })]
    const result = processTailEvents(tailItems)

    const exceptionEvent = result.find(e => e.type === 'exception')
    expect(exceptionEvent?.stack).toBe(stack)
  })

  it('handles exceptions without stack trace', () => {
    const tailItems = [createTailItem({
      exceptions: [createException({ message: 'No stack', stack: undefined })],
    })]
    const result = processTailEvents(tailItems)

    const exceptionEvent = result.find(e => e.type === 'exception')
    expect(exceptionEvent?.stack).toBeUndefined()
  })

  it('uses event timestamp for exception', () => {
    const tailItems = [createTailItem({
      eventTimestamp: 1704153600000,
      exceptions: [createException()],
    })]
    const result = processTailEvents(tailItems)

    const exceptionEvent = result.find(e => e.type === 'exception')
    expect(exceptionEvent?.timestamp).toBe(1704153600000)
  })
})

// ============================================================================
// Request ID Extraction Tests
// ============================================================================

describe('Request ID Extraction', () => {
  it('extracts x-request-id from headers', () => {
    const tailItems = [createTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/',
          method: 'GET',
          headers: { 'x-request-id': 'req-123' },
        },
      },
      logs: [createLogEntry()],
    })]
    const result = processTailEvents(tailItems)

    const events = result.filter(e => e.requestId === 'req-123')
    expect(events.length).toBeGreaterThan(0)
  })

  it('extracts X-Request-ID (uppercase) from headers', () => {
    const tailItems = [createTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/',
          method: 'GET',
          headers: { 'X-Request-ID': 'req-456' },
        },
      },
      logs: [createLogEntry()],
    })]
    const result = processTailEvents(tailItems)

    const events = result.filter(e => e.requestId === 'req-456')
    expect(events.length).toBeGreaterThan(0)
  })

  it('generates UUID when x-request-id not present', () => {
    const tailItems = [createTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/',
          method: 'GET',
          headers: {},
        },
      },
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.requestId).toMatch(/^uuid-\d+$/)
  })

  it('all events from same tail item share requestId', () => {
    const tailItems = [createTailItem({
      event: {
        request: {
          url: 'https://api.example.com.ai/',
          method: 'GET',
          headers: { 'x-request-id': 'shared-id' },
        },
      },
      logs: [createLogEntry(), createLogEntry()],
      exceptions: [createException()],
    })]
    const result = processTailEvents(tailItems)

    const requestIds = result.map(e => e.requestId)
    expect(new Set(requestIds).size).toBe(1)
    expect(requestIds[0]).toBe('shared-id')
  })
})

// ============================================================================
// Metadata Tests
// ============================================================================

describe('Request Metadata', () => {
  it('includes outcome in metadata for non-ok outcomes', () => {
    const tailItems = [createTailItem({
      outcome: 'canceled',
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.metadata?.outcome).toBe('canceled')
  })

  it('does not include metadata for ok outcomes', () => {
    const tailItems = [createTailItem({
      outcome: 'ok',
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.metadata).toBeUndefined()
  })

  it('includes outcome for exceededCpu', () => {
    const tailItems = [createTailItem({
      outcome: 'exceededCpu',
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.metadata?.outcome).toBe('exceededCpu')
  })

  it('includes outcome for exceededMemory', () => {
    const tailItems = [createTailItem({
      outcome: 'exceededMemory',
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.metadata?.outcome).toBe('exceededMemory')
  })

  it('includes outcome for exception', () => {
    const tailItems = [createTailItem({
      outcome: 'exception',
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.metadata?.outcome).toBe('exception')
  })

  it('includes outcome for unknown', () => {
    const tailItems = [createTailItem({
      outcome: 'unknown',
    })]
    const result = processTailEvents(tailItems)

    const requestEvent = result.find(e => e.type === 'request')
    expect(requestEvent?.metadata?.outcome).toBe('unknown')
  })
})

// ============================================================================
// Event Order Tests
// ============================================================================

describe('Event Order', () => {
  it('produces events in correct order: logs, exceptions, request', () => {
    const tailItems = [createTailItem({
      logs: [createLogEntry({ message: ['Log 1'] })],
      exceptions: [createException({ message: 'Error 1' })],
    })]
    const result = processTailEvents(tailItems)

    expect(result[0].type).toBe('log')
    expect(result[1].type).toBe('exception')
    expect(result[2].type).toBe('request')
  })

  it('preserves order of multiple logs', () => {
    const tailItems = [createTailItem({
      logs: [
        createLogEntry({ message: ['First'], timestamp: 100 }),
        createLogEntry({ message: ['Second'], timestamp: 200 }),
        createLogEntry({ message: ['Third'], timestamp: 300 }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const logEvents = result.filter(e => e.type === 'log')
    expect(logEvents[0].message).toContain('First')
    expect(logEvents[1].message).toContain('Second')
    expect(logEvents[2].message).toContain('Third')
  })

  it('preserves order of multiple exceptions', () => {
    const tailItems = [createTailItem({
      exceptions: [
        createException({ message: 'First error' }),
        createException({ message: 'Second error' }),
      ],
    })]
    const result = processTailEvents(tailItems)

    const exceptionEvents = result.filter(e => e.type === 'exception')
    expect(exceptionEvents[0].message).toContain('First error')
    expect(exceptionEvents[1].message).toContain('Second error')
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  it('handles empty logs and exceptions', () => {
    const tailItems = [createTailItem({
      logs: [],
      exceptions: [],
    })]
    const result = processTailEvents(tailItems)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('request')
  })

  it('handles very long log messages', () => {
    const longMessage = 'x'.repeat(10000)
    const tailItems = [createTailItem({
      logs: [createLogEntry({ message: [longMessage] })],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.message?.[0]).toBe(longMessage)
  })

  it('handles special characters in messages', () => {
    const tailItems = [createTailItem({
      logs: [createLogEntry({ message: ['Hello\nWorld\t"quotes"'] })],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.message).toContain('Hello\nWorld\t"quotes"')
  })

  it('handles unicode in messages', () => {
    const tailItems = [createTailItem({
      logs: [createLogEntry({ message: ['Hello'] })],
    })]
    const result = processTailEvents(tailItems)

    const logEvent = result.find(e => e.type === 'log')
    expect(logEvent?.message).toContain('Hello')
  })
})
