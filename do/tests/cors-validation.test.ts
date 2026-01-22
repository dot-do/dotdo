/**
 * CORS Validation Tests
 *
 * Tests for the CORS validation utilities in @dotdo/do
 *
 * @module do/tests/cors-validation.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  validateOrigin,
  validateMethods,
  validateOriginConfig,
  isValidOriginFormat,
  buildHonoCorsOptions,
  DEFAULT_CORS_METHODS,
  DEFAULT_CORS_HEADERS,
  DEFAULT_EXPOSE_HEADERS,
  VALID_HTTP_METHODS
} from '../utils/cors'

describe('CORS Validation Utilities', () => {
  describe('validateOrigin', () => {
    describe('with no origin header (not a CORS request)', () => {
      it('should allow requests without Origin header', () => {
        const result = validateOrigin(null, ['https://app.example.com'])
        expect(result.valid).toBe(true)
        expect(result.matchedOrigin).toBeNull()
      })
    })

    describe('with undefined allowedOrigins (restrictive default)', () => {
      it('should reject all cross-origin requests', () => {
        const result = validateOrigin('https://attacker.com', undefined)
        expect(result.valid).toBe(false)
        expect(result.matchedOrigin).toBeNull()
      })
    })

    describe('with wildcard origin', () => {
      it('should accept any origin when allowedOrigins is "*"', () => {
        const result = validateOrigin('https://any-site.com', '*')
        expect(result.valid).toBe(true)
        expect(result.matchedOrigin).toBe('*')
      })

      it('should accept any origin when array contains "*"', () => {
        const result = validateOrigin('https://any-site.com', ['*'])
        expect(result.valid).toBe(true)
        expect(result.matchedOrigin).toBe('*')
      })

      it('should warn when wildcard is used in production', () => {
        const result = validateOrigin('https://any-site.com', '*', true)
        expect(result.valid).toBe(true)
        expect(result.warning).toContain('security risk')
        expect(result.warning).toContain('production')
      })

      it('should not warn when wildcard is used in development', () => {
        const result = validateOrigin('https://any-site.com', '*', false)
        expect(result.valid).toBe(true)
        expect(result.warning).toBeUndefined()
      })
    })

    describe('with explicit allowed origins', () => {
      it('should accept requests from allowed origins', () => {
        const result = validateOrigin(
          'https://app.example.com',
          ['https://app.example.com', 'https://dashboard.example.com']
        )
        expect(result.valid).toBe(true)
        expect(result.matchedOrigin).toBe('https://app.example.com')
      })

      it('should reject requests from non-allowed origins', () => {
        const result = validateOrigin(
          'https://malicious.com',
          ['https://app.example.com']
        )
        expect(result.valid).toBe(false)
        expect(result.matchedOrigin).toBeNull()
      })

      it('should handle case-insensitive origin matching', () => {
        const result = validateOrigin(
          'HTTPS://APP.EXAMPLE.COM',
          ['https://app.example.com']
        )
        expect(result.valid).toBe(true)
        // Should return the original request origin case
        expect(result.matchedOrigin).toBe('HTTPS://APP.EXAMPLE.COM')
      })

      it('should handle multiple allowed origins', () => {
        const allowedOrigins = [
          'https://app.example.com',
          'https://dashboard.example.com',
          'https://admin.example.com'
        ]

        expect(validateOrigin('https://app.example.com', allowedOrigins).valid).toBe(true)
        expect(validateOrigin('https://dashboard.example.com', allowedOrigins).valid).toBe(true)
        expect(validateOrigin('https://admin.example.com', allowedOrigins).valid).toBe(true)
        expect(validateOrigin('https://other.example.com', allowedOrigins).valid).toBe(false)
      })
    })
  })

  describe('validateMethods', () => {
    it('should accept valid HTTP methods', () => {
      const result = validateMethods(['GET', 'POST', 'PUT', 'DELETE'])
      expect(result.valid).toEqual(['GET', 'POST', 'PUT', 'DELETE'])
      expect(result.invalid).toEqual([])
    })

    it('should normalize method case to uppercase', () => {
      const result = validateMethods(['get', 'Post', 'pUt'])
      expect(result.valid).toEqual(['GET', 'POST', 'PUT'])
    })

    it('should identify invalid methods', () => {
      const result = validateMethods(['GET', 'INVALID', 'POST', 'FAKE'])
      expect(result.valid).toEqual(['GET', 'POST'])
      expect(result.invalid).toEqual(['INVALID', 'FAKE'])
    })

    it('should accept all standard HTTP methods', () => {
      const allMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE', 'CONNECT']
      const result = validateMethods(allMethods)
      expect(result.valid).toEqual(allMethods)
      expect(result.invalid).toEqual([])
    })
  })

  describe('isValidOriginFormat', () => {
    it('should accept valid HTTPS origins', () => {
      expect(isValidOriginFormat('https://example.com')).toBe(true)
      expect(isValidOriginFormat('https://sub.example.com')).toBe(true)
      expect(isValidOriginFormat('https://example.com:8080')).toBe(true)
    })

    it('should accept valid HTTP origins', () => {
      expect(isValidOriginFormat('http://localhost')).toBe(true)
      expect(isValidOriginFormat('http://localhost:3000')).toBe(true)
    })

    it('should accept wildcard origin', () => {
      expect(isValidOriginFormat('*')).toBe(true)
    })

    it('should reject origins with paths', () => {
      expect(isValidOriginFormat('https://example.com/path')).toBe(false)
      expect(isValidOriginFormat('https://example.com/')).toBe(false)
    })

    it('should reject origins with query strings', () => {
      expect(isValidOriginFormat('https://example.com?query=1')).toBe(false)
    })

    it('should reject origins with hash', () => {
      expect(isValidOriginFormat('https://example.com#hash')).toBe(false)
    })

    it('should reject malformed URLs', () => {
      expect(isValidOriginFormat('not-a-url')).toBe(false)
      expect(isValidOriginFormat('//example.com')).toBe(false)
      expect(isValidOriginFormat('')).toBe(false)
    })
  })

  describe('validateOriginConfig', () => {
    it('should return empty for undefined origins', () => {
      const result = validateOriginConfig(undefined)
      expect(result.valid).toEqual([])
      expect(result.malformed).toEqual([])
    })

    it('should handle wildcard origin', () => {
      const result = validateOriginConfig('*')
      expect(result.valid).toEqual(['*'])
      expect(result.malformed).toEqual([])
    })

    it('should validate array of origins', () => {
      const result = validateOriginConfig([
        'https://app.example.com',
        'https://dashboard.example.com'
      ])
      expect(result.valid).toEqual([
        'https://app.example.com',
        'https://dashboard.example.com'
      ])
      expect(result.malformed).toEqual([])
    })

    it('should identify malformed origins', () => {
      const result = validateOriginConfig([
        'https://app.example.com',
        'https://example.com/path',
        'not-a-url',
        'https://dashboard.example.com'
      ])
      expect(result.valid).toEqual([
        'https://app.example.com',
        'https://dashboard.example.com'
      ])
      expect(result.malformed).toEqual([
        'https://example.com/path',
        'not-a-url'
      ])
    })
  })

  describe('buildHonoCorsOptions', () => {
    it('should build options with default values when origins undefined', () => {
      const options = buildHonoCorsOptions({})
      expect(options.allowMethods).toEqual([...DEFAULT_CORS_METHODS])
      expect(options.allowHeaders).toEqual([...DEFAULT_CORS_HEADERS])
      expect(options.exposeHeaders).toEqual([...DEFAULT_EXPOSE_HEADERS])
      expect(options.maxAge).toBe(86400)
      // Origin should be a function that rejects all
      expect(typeof options.origin).toBe('function')
      expect((options.origin as Function)('https://any.com', {})).toBeNull()
    })

    it('should build options with wildcard origin', () => {
      const options = buildHonoCorsOptions({ allowedOrigins: '*' })
      expect(options.origin).toBe('*')
      expect(options.credentials).toBe(false) // Wildcard cannot use credentials
    })

    it('should build options with explicit origins', () => {
      const options = buildHonoCorsOptions({
        allowedOrigins: ['https://app.example.com', 'https://dashboard.example.com']
      })

      expect(typeof options.origin).toBe('function')
      const originFn = options.origin as Function
      expect(originFn('https://app.example.com', {})).toBe('https://app.example.com')
      expect(originFn('https://dashboard.example.com', {})).toBe('https://dashboard.example.com')
      expect(originFn('https://malicious.com', {})).toBeNull()
      expect(options.credentials).toBe(true) // Explicit origins default to true
    })

    it('should respect custom methods, headers, and options', () => {
      const options = buildHonoCorsOptions({
        allowedOrigins: ['https://app.example.com'],
        allowedMethods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'X-Custom'],
        exposeHeaders: ['X-Custom-Response'],
        credentials: false,
        maxAge: 3600
      })

      expect(options.allowMethods).toEqual(['GET', 'POST'])
      expect(options.allowHeaders).toEqual(['Content-Type', 'X-Custom'])
      expect(options.exposeHeaders).toEqual(['X-Custom-Response'])
      expect(options.credentials).toBe(false)
      expect(options.maxAge).toBe(3600)
    })

    it('should filter out invalid methods', () => {
      const options = buildHonoCorsOptions({
        allowedOrigins: '*',
        allowedMethods: ['GET', 'INVALID', 'POST']
      })

      expect(options.allowMethods).toEqual(['GET', 'POST'])
    })
  })

  describe('DEFAULT constants', () => {
    it('should have expected default methods', () => {
      expect(DEFAULT_CORS_METHODS).toContain('GET')
      expect(DEFAULT_CORS_METHODS).toContain('POST')
      expect(DEFAULT_CORS_METHODS).toContain('PUT')
      expect(DEFAULT_CORS_METHODS).toContain('PATCH')
      expect(DEFAULT_CORS_METHODS).toContain('DELETE')
      expect(DEFAULT_CORS_METHODS).toContain('OPTIONS')
    })

    it('should have expected default headers', () => {
      expect(DEFAULT_CORS_HEADERS).toContain('Content-Type')
      expect(DEFAULT_CORS_HEADERS).toContain('Authorization')
      expect(DEFAULT_CORS_HEADERS).toContain('X-Request-ID')
      expect(DEFAULT_CORS_HEADERS).toContain('X-API-Key')
    })

    it('should have expected expose headers', () => {
      expect(DEFAULT_EXPOSE_HEADERS).toContain('X-Request-ID')
      expect(DEFAULT_EXPOSE_HEADERS).toContain('X-DO-Colo')
    })

    it('should have all valid HTTP methods', () => {
      expect(VALID_HTTP_METHODS.has('GET')).toBe(true)
      expect(VALID_HTTP_METHODS.has('POST')).toBe(true)
      expect(VALID_HTTP_METHODS.has('PUT')).toBe(true)
      expect(VALID_HTTP_METHODS.has('PATCH')).toBe(true)
      expect(VALID_HTTP_METHODS.has('DELETE')).toBe(true)
      expect(VALID_HTTP_METHODS.has('OPTIONS')).toBe(true)
      expect(VALID_HTTP_METHODS.has('HEAD')).toBe(true)
      expect(VALID_HTTP_METHODS.has('TRACE')).toBe(true)
      expect(VALID_HTTP_METHODS.has('CONNECT')).toBe(true)
    })
  })
})
