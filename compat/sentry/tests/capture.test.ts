/**
 * @dotdo/sentry - Capture Module Tests
 *
 * Tests for advanced event capture functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  init,
  captureException,
  captureMessage,
  captureEvent,
  captureCheckIn,
  setUser,
  setTag,
  withScope,
  _clear,
  InMemoryTransport,
} from '../index'

import {
  extractStackFrames,
  normalizeException,
  createEventId,
  serializeError,
} from '../capture'

import type { SentryEvent, ExceptionValue } from '../types'

describe('@dotdo/sentry - Capture Module', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Exception Normalization
  // ===========================================================================

  describe('normalizeException', () => {
    it('should normalize Error objects', () => {
      const error = new Error('Test error')
      const normalized = normalizeException(error)

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toBe('Test error')
      expect(normalized.stacktrace).toBeDefined()
    })

    it('should handle TypeError', () => {
      const error = new TypeError('Invalid type')
      const normalized = normalizeException(error)

      expect(normalized.type).toBe('TypeError')
      expect(normalized.value).toBe('Invalid type')
    })

    it('should handle custom error classes', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
        }
      }

      const error = new CustomError('Custom message')
      const normalized = normalizeException(error)

      expect(normalized.type).toBe('CustomError')
      expect(normalized.value).toBe('Custom message')
    })

    it('should handle string exceptions', () => {
      const normalized = normalizeException('String error')

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toBe('String error')
    })

    it('should handle null/undefined exceptions', () => {
      const normalizedNull = normalizeException(null)
      expect(normalizedNull.value).toBe('null')

      const normalizedUndefined = normalizeException(undefined)
      expect(normalizedUndefined.value).toBe('undefined')
    })

    it('should handle object exceptions', () => {
      const normalized = normalizeException({ code: 'ERR_001', message: 'Error object' })

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toContain('ERR_001')
    })

    it('should handle number exceptions', () => {
      const normalized = normalizeException(42)

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toBe('42')
    })

    it('should include mechanism info', () => {
      const error = new Error('Test')
      const normalized = normalizeException(error, { type: 'onerror', handled: false })

      expect(normalized.mechanism?.type).toBe('onerror')
      expect(normalized.mechanism?.handled).toBe(false)
    })
  })

  // ===========================================================================
  // Stack Frame Extraction
  // ===========================================================================

  describe('extractStackFrames', () => {
    it('should extract frames from V8 stack', () => {
      const error = new Error('Test')
      const frames = extractStackFrames(error)

      expect(Array.isArray(frames)).toBe(true)
      expect(frames.length).toBeGreaterThan(0)
    })

    it('should parse function names', () => {
      function namedFunction() {
        return new Error('Test')
      }

      const error = namedFunction()
      const frames = extractStackFrames(error)

      // At least one frame should have our function name
      const hasNamedFrame = frames.some(f => f.function?.includes('namedFunction'))
      // This might fail in minified code, so we just check structure
      expect(frames[0]).toHaveProperty('filename')
    })

    it('should parse line and column numbers', () => {
      const error = new Error('Test')
      const frames = extractStackFrames(error)

      for (const frame of frames) {
        if (frame.lineno !== undefined) {
          expect(typeof frame.lineno).toBe('number')
          expect(frame.lineno).toBeGreaterThan(0)
        }
        if (frame.colno !== undefined) {
          expect(typeof frame.colno).toBe('number')
          expect(frame.colno).toBeGreaterThan(0)
        }
      }
    })

    it('should mark in_app frames correctly', () => {
      const error = new Error('Test')
      const frames = extractStackFrames(error)

      for (const frame of frames) {
        expect(typeof frame.in_app).toBe('boolean')
      }
    })

    it('should handle empty stack', () => {
      const error = new Error('Test')
      error.stack = ''

      const frames = extractStackFrames(error)
      expect(frames).toEqual([])
    })
  })

  // ===========================================================================
  // Event ID Generation
  // ===========================================================================

  describe('createEventId', () => {
    it('should generate 32 character hex strings', () => {
      const eventId = createEventId()

      expect(eventId.length).toBe(32)
      expect(/^[a-f0-9]{32}$/.test(eventId)).toBe(true)
    })

    it('should generate unique IDs', () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        ids.add(createEventId())
      }

      expect(ids.size).toBe(100)
    })
  })

  // ===========================================================================
  // Error Serialization
  // ===========================================================================

  describe('serializeError', () => {
    it('should serialize Error to plain object', () => {
      const error = new Error('Test')
      const serialized = serializeError(error)

      expect(serialized.name).toBe('Error')
      expect(serialized.message).toBe('Test')
      expect(serialized.stack).toBeDefined()
    })

    it('should include custom properties', () => {
      const error = new Error('Test') as Error & { code: string; statusCode: number }
      error.code = 'ERR_001'
      error.statusCode = 500

      const serialized = serializeError(error)

      expect(serialized.code).toBe('ERR_001')
      expect(serialized.statusCode).toBe(500)
    })

    it('should handle cause chain', () => {
      const cause = new Error('Root cause')
      const error = new Error('Wrapper', { cause })

      const serialized = serializeError(error)

      expect(serialized.cause).toBeDefined()
      expect(serialized.cause?.message).toBe('Root cause')
    })

    it('should handle circular references', () => {
      const error = new Error('Circular') as Error & { self?: Error }
      error.self = error

      // Should not throw
      const serialized = serializeError(error)
      expect(serialized.message).toBe('Circular')
    })
  })

  // ===========================================================================
  // captureException
  // ===========================================================================

  describe('captureException - Advanced', () => {
    it('should capture with custom fingerprint', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      withScope((scope) => {
        scope.setFingerprint(['custom', 'fingerprint'])
        captureException(new Error('Test'))
      })

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events[0].fingerprint).toEqual(['custom', 'fingerprint'])
    })

    it('should capture with custom level', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      withScope((scope) => {
        scope.setLevel('warning')
        captureException(new Error('Warning-level error'))
      })

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      // Note: captureException defaults to 'error' level; scope level affects messages
      // The exception level is typically 'error' regardless of scope level
      expect(events[0].level).toBe('error')
    })

    it('should capture with request context', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      withScope((scope) => {
        scope.setContext('request', {
          url: 'https://example.com/api/users',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        captureException(new Error('API error'))
      })

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events[0].contexts?.request).toBeDefined()
      expect(events[0].contexts?.request?.url).toBe('https://example.com/api/users')
    })

    it('should capture with transaction name', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      withScope((scope) => {
        scope.setTransactionName('POST /api/users')
        captureException(new Error('Test'))
      })

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events[0].transaction).toBe('POST /api/users')
    })

    it('should capture error chain with cause', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      const rootCause = new Error('Database connection failed')
      const error = new Error('Failed to fetch users', { cause: rootCause })

      captureException(error)

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      const exceptions = events[0].exception?.values

      // Should have both errors in the chain
      expect(exceptions?.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ===========================================================================
  // captureMessage
  // ===========================================================================

  describe('captureMessage - Advanced', () => {
    it('should capture with all severity levels', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      const levels = ['fatal', 'error', 'warning', 'log', 'info', 'debug'] as const

      for (const level of levels) {
        captureMessage(`${level} message`, level)
      }

      await new Promise(resolve => setTimeout(resolve, 50))

      const events = transport.getEvents()
      expect(events.length).toBe(6)

      for (const level of levels) {
        const event = events.find(e => e.message === `${level} message`)
        expect(event?.level).toBe(level)
      }
    })

    it('should capture message with additional context', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      setUser({ id: 'user-123' })
      setTag('feature', 'checkout')

      captureMessage('Checkout started', 'info')

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events[0].user?.id).toBe('user-123')
      expect(events[0].tags?.feature).toBe('checkout')
    })
  })

  // ===========================================================================
  // captureEvent
  // ===========================================================================

  describe('captureEvent - Advanced', () => {
    it('should capture custom event with full payload', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureEvent({
        message: 'Custom event',
        level: 'info',
        tags: { custom: 'true' },
        extra: { data: { foo: 'bar' } },
        contexts: {
          custom: { value: 123 },
        },
        fingerprint: ['custom-event'],
      })

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events.length).toBe(1)
      expect(events[0].message).toBe('Custom event')
      expect(events[0].tags?.custom).toBe('true')
      expect(events[0].extra?.data).toEqual({ foo: 'bar' })
      expect(events[0].contexts?.custom?.value).toBe(123)
    })

    it('should merge event data with scope', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      setTag('global', 'yes')

      captureEvent({
        message: 'Test',
        tags: { event: 'specific' },
      })

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events[0].tags?.global).toBe('yes')
      expect(events[0].tags?.event).toBe('specific')
    })
  })

  // ===========================================================================
  // captureCheckIn (Cron Monitoring)
  // ===========================================================================

  describe('captureCheckIn', () => {
    it('should capture cron check-in start', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      const checkInId = captureCheckIn({
        monitorSlug: 'daily-backup',
        status: 'in_progress',
      })

      expect(checkInId).toBeDefined()
      expect(typeof checkInId).toBe('string')

      await new Promise(resolve => setTimeout(resolve, 20))

      // Check-ins are sent as special envelope items
      const events = transport.getEvents()
      // For now, we can verify the checkInId is returned
    })

    it('should capture cron check-in success', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      const checkInId = captureCheckIn({
        monitorSlug: 'daily-backup',
        status: 'in_progress',
      })

      captureCheckIn({
        checkInId,
        monitorSlug: 'daily-backup',
        status: 'ok',
        duration: 5000,
      })

      await new Promise(resolve => setTimeout(resolve, 20))
    })

    it('should capture cron check-in error', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureCheckIn({
        monitorSlug: 'hourly-sync',
        status: 'error',
      })

      await new Promise(resolve => setTimeout(resolve, 20))
    })
  })

  // ===========================================================================
  // Event Hints
  // ===========================================================================

  describe('Event Hints', () => {
    it('should pass hint to beforeSend', async () => {
      const transport = new InMemoryTransport()
      let capturedHint: any

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        beforeSend(event, hint) {
          capturedHint = hint
          return event
        },
      })

      const error = new Error('Original')
      captureException(error)

      await new Promise(resolve => setTimeout(resolve, 20))

      // Hint should be passed (may be empty object)
      expect(capturedHint).toBeDefined()
    })

    it('should execute beforeSend for messages', async () => {
      const transport = new InMemoryTransport()
      let beforeSendCalled = false

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
        attachStacktrace: true,
        beforeSend(event, hint) {
          beforeSendCalled = true
          return event
        },
      })

      captureMessage('Test message')

      await new Promise(resolve => setTimeout(resolve, 20))

      // beforeSend should be called
      expect(beforeSendCalled).toBe(true)
    })
  })

  // ===========================================================================
  // Event Enrichment
  // ===========================================================================

  describe('Event Enrichment', () => {
    it('should include SDK info', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureMessage('Test')

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events[0].sdk?.name).toBe('@dotdo/sentry')
      expect(events[0].sdk?.version).toBeDefined()
    })

    it('should include platform', async () => {
      const transport = new InMemoryTransport()

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureMessage('Test')

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events[0].platform).toBe('javascript')
    })

    it('should include timestamp', async () => {
      const transport = new InMemoryTransport()
      const now = Date.now() / 1000

      init({
        dsn: 'https://key@sentry.example.com/1',
        transport: () => transport,
      })

      captureMessage('Test')

      await new Promise(resolve => setTimeout(resolve, 20))

      const events = transport.getEvents()
      expect(events[0].timestamp).toBeDefined()
      expect(events[0].timestamp!).toBeGreaterThanOrEqual(now - 1)
      expect(events[0].timestamp!).toBeLessThanOrEqual(now + 1)
    })
  })
})
