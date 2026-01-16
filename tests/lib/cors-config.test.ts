/**
 * CORS Configuration Tests
 *
 * Tests for the centralized CORS configuration module (lib/cors-config.ts).
 * Verifies environment-based configuration, origin validation, and header building.
 */
import { describe, it, expect } from 'vitest'

import {
  parseOriginsFromEnv,
  isValidOrigin,
  getDefaultOrigins,
  getAllowedOrigins,
  validateOrigin,
  getCorsPolicy,
  buildCorsHeaders,
  getCorsConfig,
  createHonoCorsConfig,
  PRODUCTION_ORIGINS,
  STAGING_ORIGINS,
  DEVELOPMENT_ORIGINS,
  CORS_POLICIES,
  type CorsEnv,
} from '../../lib/cors-config'

describe('CORS Configuration Module', () => {
  describe('parseOriginsFromEnv', () => {
    it('should parse comma-separated origins', () => {
      const result = parseOriginsFromEnv('https://a.com,https://b.com,https://c.com')
      expect(result).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
    })

    it('should trim whitespace from origins', () => {
      const result = parseOriginsFromEnv('https://a.com, https://b.com , https://c.com')
      expect(result).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
    })

    it('should handle empty string', () => {
      const result = parseOriginsFromEnv('')
      expect(result).toEqual([])
    })

    it('should handle undefined', () => {
      const result = parseOriginsFromEnv(undefined)
      expect(result).toEqual([])
    })

    it('should filter out empty strings after splitting', () => {
      const result = parseOriginsFromEnv('https://a.com,,https://b.com, ,https://c.com')
      expect(result).toEqual(['https://a.com', 'https://b.com', 'https://c.com'])
    })

    it('should handle single origin', () => {
      const result = parseOriginsFromEnv('https://single.com')
      expect(result).toEqual(['https://single.com'])
    })
  })

  describe('isValidOrigin', () => {
    it('should accept valid https origin', () => {
      expect(isValidOrigin('https://example.com')).toBe(true)
    })

    it('should accept valid http origin', () => {
      expect(isValidOrigin('http://localhost:3000')).toBe(true)
    })

    it('should accept origin with port', () => {
      expect(isValidOrigin('https://example.com:8080')).toBe(true)
    })

    it('should reject origin with path', () => {
      expect(isValidOrigin('https://example.com/path')).toBe(false)
    })

    it('should reject origin with query string', () => {
      expect(isValidOrigin('https://example.com?query=1')).toBe(false)
    })

    it('should reject origin with hash', () => {
      expect(isValidOrigin('https://example.com#hash')).toBe(false)
    })

    it('should reject invalid URL', () => {
      expect(isValidOrigin('not-a-url')).toBe(false)
    })

    it('should reject file: protocol', () => {
      expect(isValidOrigin('file:///path/to/file')).toBe(false)
    })

    it('should reject ftp: protocol', () => {
      expect(isValidOrigin('ftp://example.com')).toBe(false)
    })

    it('should accept origin with trailing slash', () => {
      // URL parser normalizes trailing slash
      expect(isValidOrigin('https://example.com/')).toBe(true)
    })
  })

  describe('getDefaultOrigins', () => {
    it('should return production origins for production environment', () => {
      const result = getDefaultOrigins('production')
      expect(result).toEqual([...PRODUCTION_ORIGINS])
    })

    it('should return staging origins for staging environment', () => {
      const result = getDefaultOrigins('staging')
      expect(result).toEqual([...STAGING_ORIGINS])
      // Staging should include production origins
      for (const origin of PRODUCTION_ORIGINS) {
        expect(result).toContain(origin)
      }
    })

    it('should return development origins for development environment', () => {
      const result = getDefaultOrigins('development')
      expect(result).toEqual([...DEVELOPMENT_ORIGINS])
    })

    it('should return development origins for undefined environment', () => {
      const result = getDefaultOrigins(undefined)
      expect(result).toEqual([...DEVELOPMENT_ORIGINS])
    })

    it('should return development origins for unknown environment', () => {
      const result = getDefaultOrigins('unknown')
      expect(result).toEqual([...DEVELOPMENT_ORIGINS])
    })
  })

  describe('getAllowedOrigins', () => {
    it('should use ALLOWED_ORIGINS env var when set', () => {
      const env: CorsEnv = {
        ALLOWED_ORIGINS: 'https://custom1.com,https://custom2.com',
      }
      const result = getAllowedOrigins(env)
      expect(result).toEqual(['https://custom1.com', 'https://custom2.com'])
    })

    it('should fall back to production defaults when ENVIRONMENT=production', () => {
      const env: CorsEnv = {
        ENVIRONMENT: 'production',
      }
      const result = getAllowedOrigins(env)
      expect(result).toEqual([...PRODUCTION_ORIGINS])
    })

    it('should fall back to development defaults when no env vars set', () => {
      const env: CorsEnv = {}
      const result = getAllowedOrigins(env)
      expect(result).toEqual([...DEVELOPMENT_ORIGINS])
    })

    it('should validate origins from env var', () => {
      const env: CorsEnv = {
        ALLOWED_ORIGINS: 'https://valid.com,invalid-origin,https://also-valid.com',
      }
      const result = getAllowedOrigins(env)
      expect(result).toEqual(['https://valid.com', 'https://also-valid.com'])
    })

    it('should fall back to defaults when all env origins are invalid', () => {
      const env: CorsEnv = {
        ALLOWED_ORIGINS: 'invalid1,invalid2',
        ENVIRONMENT: 'production',
      }
      const result = getAllowedOrigins(env)
      expect(result).toEqual([...PRODUCTION_ORIGINS])
    })

    it('should prefer explicit ALLOWED_ORIGINS over ENVIRONMENT-based defaults', () => {
      const env: CorsEnv = {
        ALLOWED_ORIGINS: 'https://explicit.com',
        ENVIRONMENT: 'production',
      }
      const result = getAllowedOrigins(env)
      expect(result).toEqual(['https://explicit.com'])
    })
  })

  describe('validateOrigin', () => {
    it('should return origin if in allowed list', () => {
      const allowedOrigins = ['https://a.com', 'https://b.com']
      const result = validateOrigin('https://a.com', allowedOrigins)
      expect(result).toBe('https://a.com')
    })

    it('should return null if origin not in allowed list', () => {
      const allowedOrigins = ['https://a.com', 'https://b.com']
      const result = validateOrigin('https://evil.com', allowedOrigins)
      expect(result).toBeNull()
    })

    it('should return null for null origin', () => {
      const allowedOrigins = ['https://a.com']
      const result = validateOrigin(null, allowedOrigins)
      expect(result).toBeNull()
    })

    it('should return null for undefined origin', () => {
      const allowedOrigins = ['https://a.com']
      const result = validateOrigin(undefined, allowedOrigins)
      expect(result).toBeNull()
    })

    it('should be case-sensitive', () => {
      const allowedOrigins = ['https://example.com']
      const result = validateOrigin('https://EXAMPLE.COM', allowedOrigins)
      expect(result).toBeNull()
    })
  })

  describe('getCorsPolicy', () => {
    it('should return admin policy for /admin paths', () => {
      expect(getCorsPolicy('/admin')).toBe('admin')
      expect(getCorsPolicy('/admin/users')).toBe('admin')
      expect(getCorsPolicy('/admin/settings/advanced')).toBe('admin')
    })

    it('should return protected policy for other paths', () => {
      expect(getCorsPolicy('/api/items')).toBe('protected')
      expect(getCorsPolicy('/protected/data')).toBe('protected')
      expect(getCorsPolicy('/')).toBe('protected')
      expect(getCorsPolicy('/health')).toBe('protected')
    })
  })

  describe('buildCorsHeaders', () => {
    const allowedOrigins = ['https://allowed.com', 'https://another.com']

    it('should set Vary: Origin for cache safety', () => {
      const headers = buildCorsHeaders(
        'https://allowed.com',
        allowedOrigins,
        'protected'
      )
      expect(headers.get('Vary')).toBe('Origin')
    })

    it('should not set CORS headers for invalid origin', () => {
      const headers = buildCorsHeaders(
        'https://evil.com',
        allowedOrigins,
        'protected'
      )
      expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(headers.get('Access-Control-Allow-Methods')).toBeNull()
    })

    it('should set correct headers for valid origin with protected policy', () => {
      const headers = buildCorsHeaders(
        'https://allowed.com',
        allowedOrigins,
        'protected'
      )
      expect(headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.com')
      expect(headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,PUT,PATCH,DELETE,OPTIONS')
      expect(headers.get('Access-Control-Allow-Headers')).toBe('Content-Type,Authorization')
      expect(headers.get('Access-Control-Allow-Credentials')).toBe('true')
      expect(headers.get('Access-Control-Max-Age')).toBe('86400')
    })

    it('should not set any CORS headers for admin policy', () => {
      const headers = buildCorsHeaders(
        'https://allowed.com',
        allowedOrigins,
        'admin'
      )
      expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
      expect(headers.get('Access-Control-Allow-Methods')).toBeNull()
      expect(headers.get('Access-Control-Allow-Credentials')).toBeNull()
      // Vary should still be set
      expect(headers.get('Vary')).toBe('Origin')
    })

    it('should filter requested headers against policy allowlist', () => {
      const headers = buildCorsHeaders(
        'https://allowed.com',
        allowedOrigins,
        'protected',
        'Content-Type, Authorization, X-Custom-Header'
      )
      // Should only include allowed headers
      expect(headers.get('Access-Control-Allow-Headers')).toBe('Content-Type,Authorization')
    })

    it('should use custom maxAge', () => {
      const headers = buildCorsHeaders(
        'https://allowed.com',
        allowedOrigins,
        'protected',
        undefined,
        3600
      )
      expect(headers.get('Access-Control-Max-Age')).toBe('3600')
    })

    it('should not set credentials header when policy disallows', () => {
      const headers = buildCorsHeaders(
        'https://allowed.com',
        allowedOrigins,
        'public'
      )
      // Public policy has allowCredentials: false
      expect(headers.get('Access-Control-Allow-Credentials')).toBeNull()
    })
  })

  describe('getCorsConfig', () => {
    it('should return complete config object', () => {
      const env: CorsEnv = {
        ALLOWED_ORIGINS: 'https://custom.com',
      }
      const config = getCorsConfig(env)

      expect(config.allowedOrigins).toEqual(['https://custom.com'])
      expect(config.maxAge).toBe(86400)
      expect(config.policies).toEqual(CORS_POLICIES)
    })
  })

  describe('createHonoCorsConfig', () => {
    it('should create Hono-compatible config', () => {
      const env: CorsEnv = {
        ALLOWED_ORIGINS: 'https://test.com',
      }
      const config = createHonoCorsConfig(env)

      expect(config.origin('https://test.com')).toBe('https://test.com')
      expect(config.origin('https://other.com')).toBeNull()
      expect(config.allowMethods).toContain('GET')
      expect(config.allowMethods).toContain('POST')
      expect(config.allowHeaders).toContain('Content-Type')
      expect(config.allowHeaders).toContain('Authorization')
      expect(config.credentials).toBe(true)
      expect(config.maxAge).toBe(86400)
    })
  })

  describe('CORS Policies', () => {
    it('should have correct public policy', () => {
      expect(CORS_POLICIES.public.allowedMethods).toContain('GET')
      expect(CORS_POLICIES.public.allowedMethods).toContain('HEAD')
      expect(CORS_POLICIES.public.allowedMethods).toContain('OPTIONS')
      expect(CORS_POLICIES.public.allowedMethods).not.toContain('POST')
      expect(CORS_POLICIES.public.allowedMethods).not.toContain('DELETE')
      expect(CORS_POLICIES.public.allowCredentials).toBe(false)
    })

    it('should have correct protected policy', () => {
      expect(CORS_POLICIES.protected.allowedMethods).toContain('GET')
      expect(CORS_POLICIES.protected.allowedMethods).toContain('POST')
      expect(CORS_POLICIES.protected.allowedMethods).toContain('PUT')
      expect(CORS_POLICIES.protected.allowedMethods).toContain('DELETE')
      expect(CORS_POLICIES.protected.allowedHeaders).toContain('Authorization')
      expect(CORS_POLICIES.protected.allowCredentials).toBe(true)
    })

    it('should have correct admin policy', () => {
      expect(CORS_POLICIES.admin.allowedMethods).toHaveLength(0)
      expect(CORS_POLICIES.admin.allowedHeaders).toHaveLength(0)
      expect(CORS_POLICIES.admin.allowCredentials).toBe(false)
    })
  })

  describe('Default Origins', () => {
    it('should have correct production origins', () => {
      expect(PRODUCTION_ORIGINS).toContain('https://dotdo.dev')
      expect(PRODUCTION_ORIGINS).toContain('https://api.dotdo.dev')
    })

    it('should have correct development origins', () => {
      expect(DEVELOPMENT_ORIGINS).toContain('http://localhost:3000')
      expect(DEVELOPMENT_ORIGINS).toContain('http://localhost:5173')
      expect(DEVELOPMENT_ORIGINS).toContain('http://localhost:8787')
    })

    it('staging should include production origins', () => {
      for (const origin of PRODUCTION_ORIGINS) {
        expect(STAGING_ORIGINS).toContain(origin)
      }
    })
  })
})

describe('CORS Security Properties', () => {
  const allowedOrigins = DEVELOPMENT_ORIGINS as unknown as string[]

  it('should never allow wildcard origin', () => {
    // Even with an empty allowlist, should not default to wildcard
    const headers = buildCorsHeaders('https://any.com', [], 'protected')
    expect(headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(headers.get('Access-Control-Allow-Origin')).not.toBe('*')
  })

  it('should set Vary: Origin for cache safety', () => {
    // All responses should have Vary: Origin to prevent cache poisoning
    const headers1 = buildCorsHeaders('https://allowed.com', [...allowedOrigins], 'protected')
    const headers2 = buildCorsHeaders('https://evil.com', [...allowedOrigins], 'protected')
    const headers3 = buildCorsHeaders(null, [...allowedOrigins], 'protected')

    expect(headers1.get('Vary')).toBe('Origin')
    expect(headers2.get('Vary')).toBe('Origin')
    expect(headers3.get('Vary')).toBe('Origin')
  })

  it('should only allow credentials with valid origin', () => {
    // When credentials are allowed, origin must be validated
    const validHeaders = buildCorsHeaders(
      'http://localhost:3000',
      [...allowedOrigins],
      'protected'
    )
    const invalidHeaders = buildCorsHeaders(
      'https://evil.com',
      [...allowedOrigins],
      'protected'
    )

    // Valid origin gets credentials
    expect(validHeaders.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(validHeaders.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000')

    // Invalid origin gets no CORS headers
    expect(invalidHeaders.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(invalidHeaders.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('should filter requested headers to policy allowlist', () => {
    // Should not echo back arbitrary headers
    const headers = buildCorsHeaders(
      'http://localhost:3000',
      [...allowedOrigins],
      'protected',
      'Content-Type, Authorization, X-Malicious-Header, Cookie'
    )

    const allowedHeaders = headers.get('Access-Control-Allow-Headers')
    expect(allowedHeaders).toContain('Content-Type')
    expect(allowedHeaders).toContain('Authorization')
    expect(allowedHeaders).not.toContain('X-Malicious-Header')
    expect(allowedHeaders).not.toContain('Cookie')
  })
})
