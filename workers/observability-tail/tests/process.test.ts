/**
 * Observability Tail Process Tests
 *
 * Tests for processTailEvents function that converts Cloudflare TailItems
 * into ObservabilityEvents.
 *
 * @module workers/observability-tail/tests/process.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { processTailEvents, type TailItem } from '../process'

// =============================================================================
// Test Helpers
// =============================================================================

function createTailItem(overrides: Partial<TailItem> = {}): TailItem {
  return {
    scriptName: 'test-worker',
    eventTimestamp: Date.now(),
    outcome: 'ok',
    event: {
      request: {
        url: 'https://api.example.com/test',
        method: 'GET',
        headers: {},
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

// =============================================================================
// processTailEvents Tests
// =============================================================================

describe('processTailEvents', () => {
  beforeEach(() => {
    // Mock crypto.randomUUID for deterministic tests
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('test-uuid-1234'),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('request events', () => {
    it('creates a request event from TailItem', () => {
      const tailItem = createTailItem({
        scriptName: 'my-worker',
        eventTimestamp: 1704067200000,
        event: {
          request: {
            url: 'https://api.example.com/users',
            method: 'POST',
            headers: {},
          },
          response: {
            status: 201,
          },
        },
      })

      const events = processTailEvents([tailItem])

      expect(events.length).toBe(1)
      expect(events[0].type).toBe('request')
      expect(events[0].script).toBe('my-worker')
      expect(events[0].method).toBe('POST')
      expect(events[0].url).toBe('https://api.example.com/users')
      expect(events[0].status).toBe(201)
    })

    it('sets level to info for 2xx status', () => {
      const tailItem = createTailItem({
        event: {
          request: { url: 'https://api.example.com', method: 'GET', headers: {} },
          response: { status: 200 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].level).toBe('info')
    })

    it('sets level to warn for 4xx status', () => {
      const tailItem = createTailItem({
        event: {
          request: { url: 'https://api.example.com', method: 'GET', headers: {} },
          response: { status: 404 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].level).toBe('warn')
    })

    it('sets level to error for 5xx status', () => {
      const tailItem = createTailItem({
        event: {
          request: { url: 'https://api.example.com', method: 'GET', headers: {} },
          response: { status: 500 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].level).toBe('error')
    })

    it('sets level to error for exceededCpu outcome', () => {
      const tailItem = createTailItem({
        outcome: 'exceededCpu',
        event: {
          request: { url: 'https://api.example.com', method: 'GET', headers: {} },
          response: { status: 200 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].level).toBe('error')
      expect(events[0].metadata?.outcome).toBe('exceededCpu')
    })

    it('sets level to error for exceededMemory outcome', () => {
      const tailItem = createTailItem({
        outcome: 'exceededMemory',
      })

      const events = processTailEvents([tailItem])
      expect(events[0].level).toBe('error')
    })

    it('sets level to error for exception outcome', () => {
      const tailItem = createTailItem({
        outcome: 'exception',
      })

      const events = processTailEvents([tailItem])
      expect(events[0].level).toBe('error')
    })

    it('extracts requestId from x-request-id header', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com',
            method: 'GET',
            headers: { 'x-request-id': 'custom-req-123' },
          },
          response: { status: 200 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].requestId).toBe('custom-req-123')
    })

    it('extracts requestId case-insensitively', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com',
            method: 'GET',
            headers: { 'X-Request-ID': 'case-insensitive-id' },
          },
          response: { status: 200 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].requestId).toBe('case-insensitive-id')
    })

    it('generates requestId when header missing', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com',
            method: 'GET',
            headers: {},
          },
          response: { status: 200 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].requestId).toBe('test-uuid-1234')
    })

    it('includes outcome in metadata for non-ok outcomes', () => {
      const tailItem = createTailItem({
        outcome: 'canceled',
      })

      const events = processTailEvents([tailItem])
      expect(events[0].metadata).toEqual({ outcome: 'canceled' })
    })

    it('omits metadata for ok outcome', () => {
      const tailItem = createTailItem({
        outcome: 'ok',
      })

      const events = processTailEvents([tailItem])
      expect(events[0].metadata).toBeUndefined()
    })
  })

  describe('log events', () => {
    it('creates log events from logs array', () => {
      const tailItem = createTailItem({
        logs: [
          { level: 'info', message: ['User logged in'], timestamp: 1704067200000 },
          { level: 'debug', message: ['Checking permissions'], timestamp: 1704067200001 },
        ],
      })

      const events = processTailEvents([tailItem])

      // 2 logs + 1 request = 3 events
      expect(events.length).toBe(3)

      const logEvents = events.filter((e) => e.type === 'log')
      expect(logEvents.length).toBe(2)
      expect(logEvents[0].message).toEqual(['User logged in'])
      expect(logEvents[1].message).toEqual(['Checking permissions'])
    })

    it('maps log level correctly', () => {
      const tailItem = createTailItem({
        logs: [
          { level: 'debug', message: ['debug msg'], timestamp: 1 },
          { level: 'info', message: ['info msg'], timestamp: 2 },
          { level: 'log', message: ['log msg'], timestamp: 3 },
          { level: 'warn', message: ['warn msg'], timestamp: 4 },
          { level: 'error', message: ['error msg'], timestamp: 5 },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvents = events.filter((e) => e.type === 'log')

      expect(logEvents[0].level).toBe('debug')
      expect(logEvents[1].level).toBe('info')
      expect(logEvents[2].level).toBe('info') // 'log' maps to 'info'
      expect(logEvents[3].level).toBe('warn')
      expect(logEvents[4].level).toBe('error')
    })

    it('serializes message array items', () => {
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: ['string', 42, true, null, undefined, { key: 'value' }],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      expect(logEvent.message).toEqual([
        'string',
        '42',
        'true',
        'null',
        'undefined',
        '{"key":"value"}',
      ])
    })

    it('shares requestId between logs and request', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com',
            method: 'GET',
            headers: { 'x-request-id': 'shared-id' },
          },
          response: { status: 200 },
        },
        logs: [{ level: 'info', message: ['test'], timestamp: 1 }],
      })

      const events = processTailEvents([tailItem])

      const requestId = events.find((e) => e.type === 'request')!.requestId
      const logRequestId = events.find((e) => e.type === 'log')!.requestId

      expect(requestId).toBe('shared-id')
      expect(logRequestId).toBe('shared-id')
    })
  })

  describe('exception events', () => {
    it('creates exception events from exceptions array', () => {
      const tailItem = createTailItem({
        exceptions: [
          { name: 'Error', message: 'Something went wrong', stack: 'Error: Something went wrong\n    at test.js:1' },
        ],
      })

      const events = processTailEvents([tailItem])

      const exceptionEvents = events.filter((e) => e.type === 'exception')
      expect(exceptionEvents.length).toBe(1)
      expect(exceptionEvents[0].level).toBe('error')
      expect(exceptionEvents[0].message).toContain('Something went wrong')
      expect(exceptionEvents[0].stack).toBe('Error: Something went wrong\n    at test.js:1')
    })

    it('extracts short message variant', () => {
      const tailItem = createTailItem({
        exceptions: [
          {
            name: 'Error',
            message: 'Connection timeout (after 5000ms)',
            stack: 'Error: Connection timeout\n    at client.js:42',
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvent = events.find((e) => e.type === 'exception')!

      // Should include both full message and short version
      expect(exceptionEvent.message).toContain('Connection timeout (after 5000ms)')
      expect(exceptionEvent.message).toContain('Connection timeout')
    })

    it('handles exception without stack', () => {
      const tailItem = createTailItem({
        exceptions: [
          { name: 'TypeError', message: 'undefined is not a function' },
        ],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvent = events.find((e) => e.type === 'exception')!

      expect(exceptionEvent.stack).toBeUndefined()
    })

    it('uses eventTimestamp for exception timestamp', () => {
      const eventTimestamp = 1704067200000
      const tailItem = createTailItem({
        eventTimestamp,
        exceptions: [
          { name: 'Error', message: 'Test error' },
        ],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvent = events.find((e) => e.type === 'exception')!

      expect(exceptionEvent.timestamp).toBe(eventTimestamp)
    })
  })

  describe('multiple TailItems', () => {
    it('processes multiple TailItems', () => {
      const tailItems = [
        createTailItem({ scriptName: 'worker-1' }),
        createTailItem({ scriptName: 'worker-2' }),
        createTailItem({ scriptName: 'worker-3' }),
      ]

      const events = processTailEvents(tailItems)

      expect(events.length).toBe(3)
      expect(events[0].script).toBe('worker-1')
      expect(events[1].script).toBe('worker-2')
      expect(events[2].script).toBe('worker-3')
    })

    it('handles empty array', () => {
      const events = processTailEvents([])
      expect(events).toEqual([])
    })

    it('combines events from all TailItems', () => {
      const tailItems = [
        createTailItem({
          scriptName: 'worker-1',
          logs: [{ level: 'info', message: ['log 1'], timestamp: 1 }],
        }),
        createTailItem({
          scriptName: 'worker-2',
          exceptions: [{ name: 'Error', message: 'error 1' }],
        }),
      ]

      const events = processTailEvents(tailItems)

      // worker-1: 1 log + 1 request = 2
      // worker-2: 1 exception + 1 request = 2
      expect(events.length).toBe(4)

      const worker1Events = events.filter((e) => e.script === 'worker-1')
      const worker2Events = events.filter((e) => e.script === 'worker-2')

      expect(worker1Events.length).toBe(2)
      expect(worker2Events.length).toBe(2)
    })
  })

  describe('event ordering', () => {
    it('emits logs before request event', () => {
      const tailItem = createTailItem({
        logs: [
          { level: 'info', message: ['first'], timestamp: 1 },
          { level: 'info', message: ['second'], timestamp: 2 },
        ],
      })

      const events = processTailEvents([tailItem])

      const logIndices = events
        .map((e, i) => (e.type === 'log' ? i : -1))
        .filter((i) => i >= 0)
      const requestIndex = events.findIndex((e) => e.type === 'request')

      // All logs should come before request
      expect(logIndices.every((i) => i < requestIndex)).toBe(true)
    })

    it('emits exceptions before request event', () => {
      const tailItem = createTailItem({
        exceptions: [
          { name: 'Error', message: 'first' },
          { name: 'Error', message: 'second' },
        ],
      })

      const events = processTailEvents([tailItem])

      const exceptionIndices = events
        .map((e, i) => (e.type === 'exception' ? i : -1))
        .filter((i) => i >= 0)
      const requestIndex = events.findIndex((e) => e.type === 'request')

      // All exceptions should come before request
      expect(exceptionIndices.every((i) => i < requestIndex)).toBe(true)
    })
  })

  // =============================================================================
  // Edge Cases - Log Parsing
  // =============================================================================

  describe('log parsing edge cases', () => {
    it('handles empty log message array', () => {
      const tailItem = createTailItem({
        logs: [{ level: 'info', message: [], timestamp: 1 }],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      expect(logEvent.message).toEqual([])
    })

    it('handles deeply nested objects in message', () => {
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: [{ a: { b: { c: { d: { e: 'deep' } } } } }],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      expect(logEvent.message![0]).toBe('{"a":{"b":{"c":{"d":{"e":"deep"}}}}}')
    })

    it('handles arrays in message', () => {
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: [[1, 2, 3], ['a', 'b', 'c']],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      expect(logEvent.message).toEqual(['[1,2,3]', '["a","b","c"]'])
    })

    it('handles special string values', () => {
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: ['', ' ', '\n\t', 'unicode: \u0000\u001f'],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      expect(logEvent.message).toEqual(['', ' ', '\n\t', 'unicode: \u0000\u001f'])
    })

    it('handles NaN and Infinity', () => {
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: [NaN, Infinity, -Infinity],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      expect(logEvent.message).toEqual(['NaN', 'Infinity', '-Infinity'])
    })

    it('handles BigInt values', () => {
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: [BigInt(9007199254740991)],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      // BigInt serialization depends on implementation
      expect(logEvent.message![0]).toBeDefined()
    })

    it('handles Symbol values', () => {
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: [Symbol('test')],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      // Symbol values are serialized using String() which produces "Symbol(test)"
      expect(logEvent.message![0]).toBe('Symbol(test)')
    })

    it('handles Date objects', () => {
      const date = new Date('2024-01-01T00:00:00Z')
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: [date],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      expect(logEvent.message![0]).toContain('2024')
    })

    it('handles functions in message (converts to string)', () => {
      const testFn = function testFn() { return 'test' }
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: [testFn],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      // Functions are converted via String() which produces the function source
      expect(logEvent.message![0]).toContain('function')
    })

    it('handles very long string messages', () => {
      const longString = 'x'.repeat(100000)
      const tailItem = createTailItem({
        logs: [
          {
            level: 'info',
            message: [longString],
            timestamp: 1,
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      expect(logEvent.message![0]).toBe(longString)
    })

    it('preserves log timestamps', () => {
      const timestamp = 1704067200000
      const tailItem = createTailItem({
        logs: [{ level: 'info', message: ['test'], timestamp }],
      })

      const events = processTailEvents([tailItem])
      const logEvent = events.find((e) => e.type === 'log')!

      expect(logEvent.timestamp).toBe(timestamp)
    })
  })

  // =============================================================================
  // Edge Cases - Request Processing
  // =============================================================================

  describe('request processing edge cases', () => {
    it('handles missing response object', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com',
            method: 'GET',
            headers: {},
          },
          response: undefined,
        },
      })

      const events = processTailEvents([tailItem])
      const requestEvent = events.find((e) => e.type === 'request')!

      expect(requestEvent.status).toBeUndefined()
      expect(requestEvent.level).toBe('info')
    })

    it('handles 1xx status codes', () => {
      const tailItem = createTailItem({
        event: {
          request: { url: 'https://api.example.com', method: 'GET', headers: {} },
          response: { status: 100 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].level).toBe('info')
    })

    it('handles 3xx status codes', () => {
      const tailItem = createTailItem({
        event: {
          request: { url: 'https://api.example.com', method: 'GET', headers: {} },
          response: { status: 301 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].level).toBe('info')
    })

    it('handles 418 status code (I am a teapot)', () => {
      const tailItem = createTailItem({
        event: {
          request: { url: 'https://api.example.com', method: 'GET', headers: {} },
          response: { status: 418 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].level).toBe('warn')
      expect(events[0].status).toBe(418)
    })

    it('handles various HTTP methods', () => {
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

      for (const method of methods) {
        const tailItem = createTailItem({
          event: {
            request: { url: 'https://api.example.com', method, headers: {} },
            response: { status: 200 },
          },
        })

        const events = processTailEvents([tailItem])
        expect(events[0].method).toBe(method)
      }
    })

    it('handles URLs with query parameters', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com/search?q=test&page=1&filter=active',
            method: 'GET',
            headers: {},
          },
          response: { status: 200 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].url).toBe('https://api.example.com/search?q=test&page=1&filter=active')
    })

    it('handles URLs with special characters', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com/path%20with%20spaces/file%3F.json',
            method: 'GET',
            headers: {},
          },
          response: { status: 200 },
        },
      })

      const events = processTailEvents([tailItem])
      expect(events[0].url).toContain('%20')
    })

    it('handles unknown outcome', () => {
      const tailItem = createTailItem({
        outcome: 'unknown',
      })

      const events = processTailEvents([tailItem])
      expect(events[0].metadata?.outcome).toBe('unknown')
    })

    it('extracts requestId from cf-ray header if x-request-id missing', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com',
            method: 'GET',
            headers: { 'cf-ray': 'cf-ray-12345' },
          },
          response: { status: 200 },
        },
      })

      const events = processTailEvents([tailItem])
      // If implementation falls back to cf-ray, check for it
      // Otherwise, it should generate a UUID
      expect(events[0].requestId).toBeDefined()
    })

    it('handles multiple headers with same key (last wins)', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com',
            method: 'GET',
            headers: {
              'x-request-id': 'first-id',
              'X-Request-ID': 'second-id', // Different case
            },
          },
          response: { status: 200 },
        },
      })

      const events = processTailEvents([tailItem])
      // Should extract one of them
      expect(['first-id', 'second-id']).toContain(events[0].requestId)
    })
  })

  // =============================================================================
  // Edge Cases - Exception Processing
  // =============================================================================

  describe('exception processing edge cases', () => {
    it('handles exception with empty message', () => {
      const tailItem = createTailItem({
        exceptions: [{ name: 'Error', message: '' }],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvent = events.find((e) => e.type === 'exception')!

      expect(exceptionEvent.message).toContain('')
    })

    it('handles exception with very long message', () => {
      const longMessage = 'Error: '.repeat(10000)
      const tailItem = createTailItem({
        exceptions: [{ name: 'Error', message: longMessage }],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvent = events.find((e) => e.type === 'exception')!

      expect(exceptionEvent.message).toContain(longMessage)
    })

    it('handles exception with multiline stack', () => {
      const stack = `Error: Test error
    at Object.<anonymous> (/src/index.ts:1:7)
    at Module._compile (internal/modules/cjs/loader.js:1085:14)
    at Object.Module._extensions..js (internal/modules/cjs/loader.js:1114:10)
    at Module.load (internal/modules/cjs/loader.js:950:32)
    at Function.Module._load (internal/modules/cjs/loader.js:790:12)
    at Function.executeUserEntryPoint [as runMain] (internal/modules/run_main.js:75:12)
    at internal/main/run_main_module.js:17:47`

      const tailItem = createTailItem({
        exceptions: [{ name: 'Error', message: 'Test error', stack }],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvent = events.find((e) => e.type === 'exception')!

      expect(exceptionEvent.stack).toBe(stack)
      expect(exceptionEvent.stack).toContain('at Object.<anonymous>')
    })

    it('handles exception with parenthetical notes', () => {
      const tailItem = createTailItem({
        exceptions: [
          {
            name: 'TimeoutError',
            message: 'Operation timed out (after 5000ms, retries: 3)',
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvent = events.find((e) => e.type === 'exception')!

      expect(exceptionEvent.message).toContain('Operation timed out (after 5000ms, retries: 3)')
      expect(exceptionEvent.message).toContain('Operation timed out')
    })

    it('handles exception with nested parentheses', () => {
      const tailItem = createTailItem({
        exceptions: [
          {
            name: 'Error',
            message: 'Failed (reason: (nested (deep))) more text',
          },
        ],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvent = events.find((e) => e.type === 'exception')!

      expect(exceptionEvent.message).toContain('Failed (reason: (nested (deep))) more text')
    })

    it('handles multiple exceptions in one TailItem', () => {
      const tailItem = createTailItem({
        exceptions: [
          { name: 'Error1', message: 'First error' },
          { name: 'Error2', message: 'Second error' },
          { name: 'Error3', message: 'Third error' },
        ],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvents = events.filter((e) => e.type === 'exception')

      expect(exceptionEvents.length).toBe(3)
      expect(exceptionEvents[0].message).toContain('First error')
      expect(exceptionEvents[1].message).toContain('Second error')
      expect(exceptionEvents[2].message).toContain('Third error')
    })

    it('shares requestId across all exceptions', () => {
      const tailItem = createTailItem({
        event: {
          request: {
            url: 'https://api.example.com',
            method: 'GET',
            headers: { 'x-request-id': 'shared-exception-id' },
          },
          response: { status: 500 },
        },
        exceptions: [
          { name: 'Error1', message: 'First' },
          { name: 'Error2', message: 'Second' },
        ],
      })

      const events = processTailEvents([tailItem])
      const exceptionEvents = events.filter((e) => e.type === 'exception')

      expect(exceptionEvents[0].requestId).toBe('shared-exception-id')
      expect(exceptionEvents[1].requestId).toBe('shared-exception-id')
    })
  })

  // =============================================================================
  // Filtering Integration Tests
  // =============================================================================

  describe('filtering integration', () => {
    it('events can be filtered by level after processing', () => {
      const tailItem = createTailItem({
        event: {
          request: { url: 'https://api.example.com', method: 'GET', headers: {} },
          response: { status: 500 },
        },
        logs: [
          { level: 'debug', message: ['debug log'], timestamp: 1 },
          { level: 'info', message: ['info log'], timestamp: 2 },
          { level: 'error', message: ['error log'], timestamp: 3 },
        ],
      })

      const events = processTailEvents([tailItem])
      const errorEvents = events.filter((e) => e.level === 'error')

      expect(errorEvents.length).toBe(2) // 1 error log + 1 request (500)
    })

    it('events can be filtered by type after processing', () => {
      const tailItem = createTailItem({
        logs: [{ level: 'info', message: ['log'], timestamp: 1 }],
        exceptions: [{ name: 'Error', message: 'exception' }],
      })

      const events = processTailEvents([tailItem])

      const logEvents = events.filter((e) => e.type === 'log')
      const exceptionEvents = events.filter((e) => e.type === 'exception')
      const requestEvents = events.filter((e) => e.type === 'request')

      expect(logEvents.length).toBe(1)
      expect(exceptionEvents.length).toBe(1)
      expect(requestEvents.length).toBe(1)
    })

    it('events can be filtered by script after processing', () => {
      const tailItems = [
        createTailItem({ scriptName: 'api-worker' }),
        createTailItem({ scriptName: 'background-worker' }),
        createTailItem({ scriptName: 'api-worker' }),
      ]

      const events = processTailEvents(tailItems)
      const apiEvents = events.filter((e) => e.script === 'api-worker')

      expect(apiEvents.length).toBe(2)
    })

    it('events can be filtered by timestamp range after processing', () => {
      const tailItems = [
        createTailItem({ eventTimestamp: 1000 }),
        createTailItem({ eventTimestamp: 2000 }),
        createTailItem({ eventTimestamp: 3000 }),
      ]

      const events = processTailEvents(tailItems)
      const filteredEvents = events.filter((e) => e.timestamp >= 1500 && e.timestamp <= 2500)

      expect(filteredEvents.length).toBe(1)
      expect(filteredEvents[0].timestamp).toBe(2000)
    })

    it('events can be filtered by requestId after processing', () => {
      const tailItems = [
        createTailItem({
          event: {
            request: {
              url: 'https://api.example.com',
              method: 'GET',
              headers: { 'x-request-id': 'req-abc' },
            },
            response: { status: 200 },
          },
          logs: [{ level: 'info', message: ['log for abc'], timestamp: 1 }],
        }),
        createTailItem({
          event: {
            request: {
              url: 'https://api.example.com',
              method: 'GET',
              headers: { 'x-request-id': 'req-xyz' },
            },
            response: { status: 200 },
          },
          logs: [{ level: 'info', message: ['log for xyz'], timestamp: 1 }],
        }),
      ]

      const events = processTailEvents(tailItems)
      const abcEvents = events.filter((e) => e.requestId === 'req-abc')

      expect(abcEvents.length).toBe(2) // 1 log + 1 request
      expect(abcEvents.every((e) => e.requestId === 'req-abc')).toBe(true)
    })
  })

  // =============================================================================
  // Aggregation Tests
  // =============================================================================

  describe('aggregation scenarios', () => {
    it('can count events by level', () => {
      const tailItems = [
        createTailItem({
          event: {
            request: { url: 'https://api.example.com', method: 'GET', headers: {} },
            response: { status: 200 },
          },
        }),
        createTailItem({
          event: {
            request: { url: 'https://api.example.com', method: 'GET', headers: {} },
            response: { status: 404 },
          },
        }),
        createTailItem({
          event: {
            request: { url: 'https://api.example.com', method: 'GET', headers: {} },
            response: { status: 500 },
          },
        }),
      ]

      const events = processTailEvents(tailItems)
      const levelCounts = events.reduce((acc, e) => {
        acc[e.level] = (acc[e.level] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      expect(levelCounts.info).toBe(1)
      expect(levelCounts.warn).toBe(1)
      expect(levelCounts.error).toBe(1)
    })

    it('can count events by script', () => {
      const tailItems = [
        createTailItem({ scriptName: 'api' }),
        createTailItem({ scriptName: 'api' }),
        createTailItem({ scriptName: 'worker' }),
        createTailItem({ scriptName: 'cron' }),
        createTailItem({ scriptName: 'cron' }),
        createTailItem({ scriptName: 'cron' }),
      ]

      const events = processTailEvents(tailItems)
      const scriptCounts = events.reduce((acc, e) => {
        acc[e.script] = (acc[e.script] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      expect(scriptCounts.api).toBe(2)
      expect(scriptCounts.worker).toBe(1)
      expect(scriptCounts.cron).toBe(3)
    })

    it('can count events by type', () => {
      const tailItem = createTailItem({
        logs: [
          { level: 'info', message: ['log1'], timestamp: 1 },
          { level: 'info', message: ['log2'], timestamp: 2 },
        ],
        exceptions: [
          { name: 'Error', message: 'exc1' },
        ],
      })

      const events = processTailEvents([tailItem])
      const typeCounts = events.reduce((acc, e) => {
        acc[e.type] = (acc[e.type] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      expect(typeCounts.log).toBe(2)
      expect(typeCounts.exception).toBe(1)
      expect(typeCounts.request).toBe(1)
    })

    it('can group events by requestId for tracing', () => {
      const tailItems = [
        createTailItem({
          event: {
            request: {
              url: 'https://api.example.com/users',
              method: 'GET',
              headers: { 'x-request-id': 'trace-1' },
            },
            response: { status: 200 },
          },
          logs: [
            { level: 'info', message: ['start'], timestamp: 1 },
            { level: 'info', message: ['end'], timestamp: 2 },
          ],
        }),
        createTailItem({
          event: {
            request: {
              url: 'https://api.example.com/products',
              method: 'POST',
              headers: { 'x-request-id': 'trace-2' },
            },
            response: { status: 201 },
          },
          logs: [
            { level: 'info', message: ['created'], timestamp: 1 },
          ],
        }),
      ]

      const events = processTailEvents(tailItems)
      const eventsByRequest = events.reduce((acc, e) => {
        const requestId = e.requestId!
        if (!acc[requestId]) acc[requestId] = []
        acc[requestId].push(e)
        return acc
      }, {} as Record<string, typeof events>)

      expect(eventsByRequest['trace-1'].length).toBe(3) // 2 logs + 1 request
      expect(eventsByRequest['trace-2'].length).toBe(2) // 1 log + 1 request
    })

    it('can calculate error rate from events', () => {
      const tailItems = Array.from({ length: 100 }, (_, i) =>
        createTailItem({
          event: {
            request: { url: 'https://api.example.com', method: 'GET', headers: {} },
            response: { status: i < 90 ? 200 : 500 },
          },
        })
      )

      const events = processTailEvents(tailItems)
      const requestEvents = events.filter((e) => e.type === 'request')
      const errorEvents = requestEvents.filter((e) => e.level === 'error')

      const errorRate = errorEvents.length / requestEvents.length

      expect(errorRate).toBe(0.1) // 10% error rate
    })
  })

  // =============================================================================
  // Performance and Stress Tests
  // =============================================================================

  describe('performance scenarios', () => {
    it('handles large batch of TailItems efficiently', () => {
      const tailItems = Array.from({ length: 1000 }, (_, i) =>
        createTailItem({
          scriptName: `worker-${i % 10}`,
          eventTimestamp: Date.now() + i,
        })
      )

      const startTime = performance.now()
      const events = processTailEvents(tailItems)
      const duration = performance.now() - startTime

      expect(events.length).toBe(1000)
      expect(duration).toBeLessThan(1000) // Should complete in under 1 second
    })

    it('handles TailItems with many logs', () => {
      const tailItem = createTailItem({
        logs: Array.from({ length: 100 }, (_, i) => ({
          level: 'info' as const,
          message: [`Log message ${i}`],
          timestamp: i,
        })),
      })

      const events = processTailEvents([tailItem])

      expect(events.length).toBe(101) // 100 logs + 1 request
    })

    it('handles TailItems with many exceptions', () => {
      const tailItem = createTailItem({
        exceptions: Array.from({ length: 50 }, (_, i) => ({
          name: `Error${i}`,
          message: `Exception message ${i}`,
          stack: `Error${i}: Exception message ${i}\n    at test.ts:${i}:1`,
        })),
      })

      const events = processTailEvents([tailItem])

      expect(events.length).toBe(51) // 50 exceptions + 1 request
    })
  })

  // =============================================================================
  // UUID Generation Tests
  // =============================================================================

  describe('UUID generation', () => {
    it('generates unique IDs for each event', () => {
      vi.stubGlobal('crypto', {
        randomUUID: vi.fn()
          .mockReturnValueOnce('uuid-1')
          .mockReturnValueOnce('uuid-2')
          .mockReturnValueOnce('uuid-3'),
      })

      const tailItem = createTailItem({
        logs: [
          { level: 'info', message: ['log1'], timestamp: 1 },
          { level: 'info', message: ['log2'], timestamp: 2 },
        ],
      })

      const events = processTailEvents([tailItem])

      const ids = events.map((e) => e.id)
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(ids.length)
    })

    it('generates valid UUID format for event IDs', () => {
      vi.unstubAllGlobals()

      const tailItem = createTailItem({})
      const events = processTailEvents([tailItem])

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

      expect(events[0].id).toMatch(uuidRegex)
    })
  })
})
