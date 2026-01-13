/**
 * Tests for safe JSON parsing utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { safeJsonParse } from '../utils/json'
import type { Logger } from '../utils/logger'

describe('safeJsonParse', () => {
  describe('valid JSON', () => {
    it('should parse valid JSON objects', () => {
      const result = safeJsonParse('{"key": "value"}', {})
      expect(result).toEqual({ key: 'value' })
    })

    it('should parse valid JSON arrays', () => {
      const result = safeJsonParse('[1, 2, 3]', [])
      expect(result).toEqual([1, 2, 3])
    })

    it('should parse valid JSON primitives', () => {
      expect(safeJsonParse('"hello"', '')).toBe('hello')
      expect(safeJsonParse('123', 0)).toBe(123)
      expect(safeJsonParse('true', false)).toBe(true)
      expect(safeJsonParse('null', 'fallback')).toBe(null)
    })

    it('should parse nested JSON structures', () => {
      const json = '{"nested": {"array": [1, 2], "object": {"a": "b"}}}'
      const result = safeJsonParse(json, {})
      expect(result).toEqual({
        nested: {
          array: [1, 2],
          object: { a: 'b' },
        },
      })
    })
  })

  describe('invalid JSON', () => {
    it('should return fallback for malformed JSON', () => {
      const fallback = { default: true }
      expect(safeJsonParse('{invalid', fallback)).toBe(fallback)
    })

    it('should return fallback for truncated JSON', () => {
      const fallback: string[] = []
      expect(safeJsonParse('[1, 2, 3', fallback)).toBe(fallback)
    })

    it('should return fallback for non-JSON strings', () => {
      const fallback = {}
      expect(safeJsonParse('hello world', fallback)).toBe(fallback)
    })

    it('should return fallback for empty string', () => {
      const fallback = { empty: true }
      expect(safeJsonParse('', fallback)).toBe(fallback)
    })

    it('should return fallback for corrupted brackets', () => {
      const fallback = {}
      expect(safeJsonParse('{{{{', fallback)).toBe(fallback)
      expect(safeJsonParse('[[[[', fallback)).toBe(fallback)
      expect(safeJsonParse('}{', fallback)).toBe(fallback)
    })
  })

  describe('logging', () => {
    let mockLogger: Logger

    beforeEach(() => {
      mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger
    })

    afterEach(() => {
      vi.clearAllMocks()
    })

    it('should not log when parsing succeeds', () => {
      safeJsonParse('{"valid": true}', {}, mockLogger)
      expect(mockLogger.debug).not.toHaveBeenCalled()
    })

    it('should log debug message when parsing fails', () => {
      safeJsonParse('{invalid json', {}, mockLogger)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Failed to parse JSON, using fallback',
        expect.objectContaining({
          error: expect.any(String),
          jsonPreview: expect.any(String),
        })
      )
    })

    it('should truncate long JSON in log preview', () => {
      const longJson = 'x'.repeat(100)
      safeJsonParse(longJson, {}, mockLogger)

      const call = (mockLogger.debug as ReturnType<typeof vi.fn>).mock.calls[0]
      const logData = call[1] as { jsonPreview: string }
      expect(logData.jsonPreview.length).toBeLessThanOrEqual(53) // 50 chars + '...'
      expect(logData.jsonPreview.endsWith('...')).toBe(true)
    })

    it('should not truncate short JSON in log preview', () => {
      const shortJson = 'invalid'
      safeJsonParse(shortJson, {}, mockLogger)

      const call = (mockLogger.debug as ReturnType<typeof vi.fn>).mock.calls[0]
      const logData = call[1] as { jsonPreview: string }
      expect(logData.jsonPreview).toBe('invalid')
    })

    it('should not log when no logger provided', () => {
      // Just verify this doesn't throw
      expect(() => safeJsonParse('{invalid', {})).not.toThrow()
    })
  })

  describe('type inference', () => {
    it('should infer type from fallback', () => {
      interface User {
        name: string
        age: number
      }
      const fallback: User = { name: 'unknown', age: 0 }
      const result = safeJsonParse<User>('{"name": "John", "age": 30}', fallback)

      // TypeScript should infer result as User
      expect(result.name).toBe('John')
      expect(result.age).toBe(30)
    })

    it('should return fallback with correct type on failure', () => {
      interface Config {
        enabled: boolean
        count: number
      }
      const fallback: Config = { enabled: false, count: 0 }
      const result = safeJsonParse<Config>('{invalid', fallback)

      expect(result).toBe(fallback)
      expect(result.enabled).toBe(false)
      expect(result.count).toBe(0)
    })
  })
})
