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
})
