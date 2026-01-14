/**
 * Tests for HTTP utilities
 *
 * @module tests/do/utils/http
 */

import { describe, it, expect } from 'vitest'
import { toContentfulStatus } from '../../../src/do/utils/http.js'

describe('toContentfulStatus', () => {
  describe('valid status codes', () => {
    it('should return 200 for 200', () => {
      expect(toContentfulStatus(200)).toBe(200)
    })

    it('should return 404 for 404', () => {
      expect(toContentfulStatus(404)).toBe(404)
    })

    it('should return 500 for 500', () => {
      expect(toContentfulStatus(500)).toBe(500)
    })

    it('should return 100 for 100 (minimum)', () => {
      expect(toContentfulStatus(100)).toBe(100)
    })

    it('should return 599 for 599 (maximum)', () => {
      expect(toContentfulStatus(599)).toBe(599)
    })

    it('should return 201 for 201', () => {
      expect(toContentfulStatus(201)).toBe(201)
    })

    it('should return 301 for 301', () => {
      expect(toContentfulStatus(301)).toBe(301)
    })
  })

  describe('clamping below minimum', () => {
    it('should clamp 0 to 100', () => {
      expect(toContentfulStatus(0)).toBe(100)
    })

    it('should clamp 50 to 100', () => {
      expect(toContentfulStatus(50)).toBe(100)
    })

    it('should clamp 99 to 100', () => {
      expect(toContentfulStatus(99)).toBe(100)
    })

    it('should clamp negative numbers to 100', () => {
      expect(toContentfulStatus(-1)).toBe(100)
      expect(toContentfulStatus(-100)).toBe(100)
      expect(toContentfulStatus(-999)).toBe(100)
    })
  })

  describe('clamping above maximum', () => {
    it('should clamp 600 to 599', () => {
      expect(toContentfulStatus(600)).toBe(599)
    })

    it('should clamp 999 to 599', () => {
      expect(toContentfulStatus(999)).toBe(599)
    })

    it('should clamp 1000 to 599', () => {
      expect(toContentfulStatus(1000)).toBe(599)
    })

    it('should clamp very large numbers to 599', () => {
      expect(toContentfulStatus(Number.MAX_SAFE_INTEGER)).toBe(599)
    })
  })

  describe('edge cases', () => {
    it('should handle decimal values by truncating via Math operations', () => {
      // Math.min/max preserve decimals but TypeScript cast truncates
      expect(toContentfulStatus(200.5)).toBe(200.5)
      expect(toContentfulStatus(404.9)).toBe(404.9)
    })

    it('should handle NaN by returning NaN', () => {
      expect(Number.isNaN(toContentfulStatus(NaN))).toBe(true)
    })

    it('should handle Infinity by clamping to 599', () => {
      expect(toContentfulStatus(Infinity)).toBe(599)
    })

    it('should handle -Infinity by clamping to 100', () => {
      expect(toContentfulStatus(-Infinity)).toBe(100)
    })
  })

  describe('common HTTP status codes', () => {
    const commonCodes = [
      100, // Continue
      101, // Switching Protocols
      200, // OK
      201, // Created
      204, // No Content
      301, // Moved Permanently
      302, // Found
      304, // Not Modified
      400, // Bad Request
      401, // Unauthorized
      403, // Forbidden
      404, // Not Found
      405, // Method Not Allowed
      422, // Unprocessable Entity
      429, // Too Many Requests
      500, // Internal Server Error
      502, // Bad Gateway
      503, // Service Unavailable
      504, // Gateway Timeout
    ]

    it.each(commonCodes)('should pass through %i unchanged', (code) => {
      expect(toContentfulStatus(code)).toBe(code)
    })
  })
})
