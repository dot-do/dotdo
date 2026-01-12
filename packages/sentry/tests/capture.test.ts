/**
 * @dotdo/sentry - Capture Utilities Tests
 *
 * RED phase: Tests for capture utilities
 * - Event ID generation
 * - Stack frame extraction
 * - Exception normalization
 * - Event creation helpers
 */

import { describe, it, expect } from 'vitest'
import {
  createEventId,
  extractStackFrames,
  normalizeException,
  normalizeExceptionChain,
  serializeError,
  createBaseEvent,
  createExceptionEvent,
  createMessageEvent,
} from '../src/capture.js'

describe('@dotdo/sentry - Capture Utilities', () => {
  describe('createEventId', () => {
    it('should generate 32 character hex string', () => {
      const id = createEventId()

      expect(id).toMatch(/^[a-f0-9]{32}$/)
    })

    it('should generate unique IDs', () => {
      const ids = new Set<string>()

      for (let i = 0; i < 100; i++) {
        ids.add(createEventId())
      }

      expect(ids.size).toBe(100)
    })
  })

  describe('extractStackFrames', () => {
    it('should extract frames from Error stack', () => {
      const error = new Error('Test error')
      const frames = extractStackFrames(error)

      expect(frames.length).toBeGreaterThan(0)
      expect(frames[0]).toHaveProperty('filename')
      expect(frames[0]).toHaveProperty('lineno')
    })

    it('should return empty array for Error without stack', () => {
      const error = new Error('Test')
      error.stack = undefined
      const frames = extractStackFrames(error)

      expect(frames).toEqual([])
    })

    it('should mark node_modules as not in_app', () => {
      // Create a mock stack with node_modules
      const error = new Error('Test')
      error.stack = `Error: Test
    at someFunction (node_modules/some-package/index.js:1:1)
    at myFunction (src/app.ts:10:5)`
      const frames = extractStackFrames(error)

      const nodeModulesFrame = frames.find((f) => f.filename?.includes('node_modules'))
      const appFrame = frames.find((f) => f.filename?.includes('src/'))

      if (nodeModulesFrame) {
        expect(nodeModulesFrame.in_app).toBe(false)
      }
      if (appFrame) {
        expect(appFrame.in_app).toBe(true)
      }
    })

    it('should reverse frames (oldest first)', () => {
      const error = new Error('Test')
      error.stack = `Error: Test
    at inner (file.js:1:1)
    at outer (file.js:2:1)`
      const frames = extractStackFrames(error)

      // Sentry expects oldest first
      expect(frames[0]?.function).toBe('outer')
      expect(frames[1]?.function).toBe('inner')
    })
  })

  describe('normalizeException', () => {
    it('should normalize Error objects', () => {
      const error = new Error('Test error')
      const normalized = normalizeException(error)

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toBe('Test error')
      expect(normalized.stacktrace).toBeDefined()
      expect(normalized.mechanism?.type).toBe('generic')
      expect(normalized.mechanism?.handled).toBe(true)
    })

    it('should normalize TypeError', () => {
      const error = new TypeError('Invalid type')
      const normalized = normalizeException(error)

      expect(normalized.type).toBe('TypeError')
      expect(normalized.value).toBe('Invalid type')
    })

    it('should normalize null', () => {
      const normalized = normalizeException(null)

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toBe('null')
    })

    it('should normalize undefined', () => {
      const normalized = normalizeException(undefined)

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toBe('undefined')
    })

    it('should normalize strings', () => {
      const normalized = normalizeException('String error')

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toBe('String error')
    })

    it('should normalize numbers', () => {
      const normalized = normalizeException(42)

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toBe('42')
    })

    it('should normalize plain objects', () => {
      const normalized = normalizeException({ error: true, code: 500 })

      expect(normalized.type).toBe('Error')
      expect(normalized.value).toContain('error')
    })

    it('should use provided mechanism', () => {
      const error = new Error('Test')
      const normalized = normalizeException(error, {
        type: 'instrument',
        handled: false,
        data: { function: 'fetch' },
      })

      expect(normalized.mechanism?.type).toBe('instrument')
      expect(normalized.mechanism?.handled).toBe(false)
      expect(normalized.mechanism?.data?.function).toBe('fetch')
    })
  })

  describe('normalizeExceptionChain', () => {
    it('should handle single error', () => {
      const error = new Error('Test')
      const chain = normalizeExceptionChain(error)

      expect(chain).toHaveLength(1)
    })

    it('should handle error with cause', () => {
      const cause = new Error('Root cause')
      const error = new Error('Outer error', { cause })
      const chain = normalizeExceptionChain(error)

      expect(chain).toHaveLength(2)
      // Root cause should be first
      expect(chain[0]?.value).toBe('Root cause')
      expect(chain[1]?.value).toBe('Outer error')
    })

    it('should limit chain depth', () => {
      let error: Error | undefined = new Error('Level 0')

      for (let i = 1; i <= 15; i++) {
        error = new Error(`Level ${i}`, { cause: error })
      }

      const chain = normalizeExceptionChain(error)

      // Should be limited to prevent infinite loops
      expect(chain.length).toBeLessThanOrEqual(11)
    })
  })

  describe('serializeError', () => {
    it('should serialize basic Error', () => {
      const error = new Error('Test error')
      const serialized = serializeError(error)

      expect(serialized.name).toBe('Error')
      expect(serialized.message).toBe('Test error')
      expect(serialized.stack).toBeDefined()
    })

    it('should serialize Error with custom properties', () => {
      const error = new Error('Test') as Error & { code: string; statusCode: number }
      error.code = 'ERR_CUSTOM'
      error.statusCode = 500

      const serialized = serializeError(error)

      expect(serialized.code).toBe('ERR_CUSTOM')
      expect(serialized.statusCode).toBe(500)
    })

    it('should serialize Error with cause', () => {
      const cause = new Error('Cause')
      const error = new Error('Outer', { cause })

      const serialized = serializeError(error)

      expect(serialized.cause).toBeDefined()
      expect(serialized.cause?.message).toBe('Cause')
    })

    it('should handle circular references', () => {
      const error = new Error('Test') as Error & { self?: Error }
      error.self = error

      // Should not throw
      const serialized = serializeError(error)
      expect(serialized.name).toBe('Error')
    })
  })

  describe('createBaseEvent', () => {
    it('should create event with required fields', () => {
      const event = createBaseEvent({
        message: 'Test message',
      })

      expect(event.event_id).toMatch(/^[a-f0-9]{32}$/)
      expect(event.timestamp).toBeDefined()
      expect(event.platform).toBe('javascript')
      expect(event.level).toBe('error')
      expect(event.message).toBe('Test message')
      expect(event.sdk).toEqual({
        name: '@dotdo/sentry',
        version: expect.any(String),
      })
    })

    it('should use provided event ID', () => {
      const customId = 'a'.repeat(32)
      const event = createBaseEvent({ eventId: customId })

      expect(event.event_id).toBe(customId)
    })

    it('should use provided level', () => {
      const event = createBaseEvent({ level: 'warning' })

      expect(event.level).toBe('warning')
    })

    it('should include release and environment', () => {
      const event = createBaseEvent({
        release: '1.0.0',
        environment: 'production',
      })

      expect(event.release).toBe('1.0.0')
      expect(event.environment).toBe('production')
    })
  })

  describe('createExceptionEvent', () => {
    it('should create exception event from Error', () => {
      const error = new Error('Test error')
      const event = createExceptionEvent(error)

      expect(event.level).toBe('error')
      expect(event.exception?.values).toBeDefined()
      expect(event.exception?.values?.[0]?.value).toBe('Test error')
    })

    it('should include stack trace', () => {
      const error = new Error('Test')
      const event = createExceptionEvent(error)

      expect(event.exception?.values?.[0]?.stacktrace?.frames).toBeDefined()
    })

    it('should use provided mechanism', () => {
      const error = new Error('Test')
      const event = createExceptionEvent(error, {
        mechanism: { type: 'onunhandledrejection', handled: false },
      })

      expect(event.exception?.values?.[0]?.mechanism?.type).toBe('onunhandledrejection')
    })
  })

  describe('createMessageEvent', () => {
    it('should create message event', () => {
      const event = createMessageEvent('Test message')

      expect(event.message).toBe('Test message')
      expect(event.level).toBe('info')
    })

    it('should use provided level', () => {
      const event = createMessageEvent('Warning', { level: 'warning' })

      expect(event.level).toBe('warning')
    })

    it('should attach stacktrace when requested', () => {
      const event = createMessageEvent('Test', { attachStacktrace: true })

      expect(event.exception?.values).toBeDefined()
      expect(event.exception?.values?.[0]?.stacktrace?.frames).toBeDefined()
    })

    it('should not attach stacktrace by default', () => {
      const event = createMessageEvent('Test')

      expect(event.exception).toBeUndefined()
    })
  })
})
