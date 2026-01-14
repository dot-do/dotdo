/**
 * Namespace Validation Tests (RED phase)
 *
 * Security tests for namespace extraction from URL path.
 * These tests should FAIL until validation is implemented.
 *
 * Security Issue: dotdo-qvafw
 * Problem: Malicious namespaces like `../admin` or extremely long strings
 * could cause path traversal or other injection attacks.
 *
 * @module npmx/test/do/namespace-validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import the validation function that will be implemented
import { validateNamespace, NAMESPACE_MAX_LENGTH, NAMESPACE_REGEX } from '../../do/namespace'

// ============================================================================
// VALIDATION FUNCTION TESTS
// ============================================================================

describe('Namespace Validation', () => {
  describe('validateNamespace function', () => {
    describe('should reject path traversal attempts', () => {
      it('rejects ../ prefix', () => {
        expect(validateNamespace('../admin')).toBe(false)
      })

      it('rejects multiple ../ patterns', () => {
        expect(validateNamespace('../../etc/passwd')).toBe(false)
      })

      it('rejects ../ in the middle', () => {
        expect(validateNamespace('foo/../bar')).toBe(false)
      })

      it('rejects URL-encoded path traversal (..%2F)', () => {
        expect(validateNamespace('..%2Fadmin')).toBe(false)
      })

      it('rejects double URL-encoded path traversal', () => {
        expect(validateNamespace('..%252Fadmin')).toBe(false)
      })

      it('rejects backslash traversal (Windows-style)', () => {
        expect(validateNamespace('..\\admin')).toBe(false)
      })
    })

    describe('should reject empty namespace', () => {
      it('rejects empty string', () => {
        expect(validateNamespace('')).toBe(false)
      })

      it('rejects whitespace-only string', () => {
        expect(validateNamespace('   ')).toBe(false)
      })

      it('rejects null character', () => {
        expect(validateNamespace('\0')).toBe(false)
      })
    })

    describe('should reject namespace exceeding max length', () => {
      it('rejects namespace longer than 64 characters', () => {
        const longNamespace = 'a'.repeat(65)
        expect(validateNamespace(longNamespace)).toBe(false)
      })

      it('rejects namespace of exactly 65 characters', () => {
        const namespace65 = 'x'.repeat(65)
        expect(validateNamespace(namespace65)).toBe(false)
      })

      it('accepts namespace of exactly 64 characters', () => {
        const namespace64 = 'x'.repeat(64)
        expect(validateNamespace(namespace64)).toBe(true)
      })

      it('rejects very long namespace (1000+ chars)', () => {
        const veryLong = 'a'.repeat(1000)
        expect(validateNamespace(veryLong)).toBe(false)
      })
    })

    describe('should reject invalid characters', () => {
      it('rejects forward slash', () => {
        expect(validateNamespace('foo/bar')).toBe(false)
      })

      it('rejects backslash', () => {
        expect(validateNamespace('foo\\bar')).toBe(false)
      })

      it('rejects spaces', () => {
        expect(validateNamespace('foo bar')).toBe(false)
      })

      it('rejects special characters', () => {
        expect(validateNamespace('foo@bar')).toBe(false)
        expect(validateNamespace('foo#bar')).toBe(false)
        expect(validateNamespace('foo$bar')).toBe(false)
        expect(validateNamespace('foo%bar')).toBe(false)
        expect(validateNamespace('foo&bar')).toBe(false)
        expect(validateNamespace('foo*bar')).toBe(false)
      })

      it('rejects dots (except within valid patterns)', () => {
        expect(validateNamespace('.')).toBe(false)
        expect(validateNamespace('..')).toBe(false)
        expect(validateNamespace('foo.')).toBe(false)
        expect(validateNamespace('.foo')).toBe(false)
      })

      it('rejects newlines and control characters', () => {
        expect(validateNamespace('foo\nbar')).toBe(false)
        expect(validateNamespace('foo\rbar')).toBe(false)
        expect(validateNamespace('foo\tbar')).toBe(false)
      })

      it('rejects Unicode characters', () => {
        expect(validateNamespace('foo\u00e9bar')).toBe(false) // e with accent
        expect(validateNamespace('\u4e2d\u6587')).toBe(false) // Chinese characters
      })

      it('rejects emoji', () => {
        expect(validateNamespace('foo\u{1F600}bar')).toBe(false)
      })
    })

    describe('should accept valid namespaces', () => {
      it('accepts simple alphanumeric', () => {
        expect(validateNamespace('tenant123')).toBe(true)
      })

      it('accepts lowercase letters only', () => {
        expect(validateNamespace('mycompany')).toBe(true)
      })

      it('accepts uppercase letters only', () => {
        expect(validateNamespace('MYCOMPANY')).toBe(true)
      })

      it('accepts mixed case', () => {
        expect(validateNamespace('MyCompany')).toBe(true)
      })

      it('accepts numbers only', () => {
        expect(validateNamespace('12345')).toBe(true)
      })

      it('accepts hyphens', () => {
        expect(validateNamespace('my-company')).toBe(true)
        expect(validateNamespace('my-company-123')).toBe(true)
      })

      it('accepts underscores', () => {
        expect(validateNamespace('my_company')).toBe(true)
        expect(validateNamespace('my_company_123')).toBe(true)
      })

      it('accepts mixed hyphens and underscores', () => {
        expect(validateNamespace('my-company_v2')).toBe(true)
      })

      it('accepts single character', () => {
        expect(validateNamespace('a')).toBe(true)
        expect(validateNamespace('1')).toBe(true)
        expect(validateNamespace('-')).toBe(true)
        expect(validateNamespace('_')).toBe(true)
      })

      it('accepts default namespace', () => {
        expect(validateNamespace('default')).toBe(true)
      })

      it('accepts common namespace patterns', () => {
        expect(validateNamespace('acme-corp')).toBe(true)
        expect(validateNamespace('user-123')).toBe(true)
        expect(validateNamespace('project_alpha')).toBe(true)
        expect(validateNamespace('tenant-001')).toBe(true)
      })
    })
  })

  describe('NAMESPACE_MAX_LENGTH constant', () => {
    it('should be 64', () => {
      expect(NAMESPACE_MAX_LENGTH).toBe(64)
    })
  })

  describe('NAMESPACE_REGEX constant', () => {
    it('should match valid patterns', () => {
      expect(NAMESPACE_REGEX.test('valid-namespace')).toBe(true)
      expect(NAMESPACE_REGEX.test('valid_namespace')).toBe(true)
      expect(NAMESPACE_REGEX.test('ValidNamespace123')).toBe(true)
    })

    it('should not match invalid patterns', () => {
      expect(NAMESPACE_REGEX.test('../admin')).toBe(false)
      expect(NAMESPACE_REGEX.test('')).toBe(false)
      expect(NAMESPACE_REGEX.test('foo/bar')).toBe(false)
    })
  })
})

// ============================================================================
// WORKER LOGIC TESTS (without importing cloudflare:workers)
// ============================================================================

/**
 * These tests verify the worker fetch logic pattern without importing the actual
 * worker module (which requires cloudflare:workers runtime).
 *
 * The logic being tested is:
 * 1. Extract namespace from URL path
 * 2. Validate namespace using validateNamespace()
 * 3. Return 400 if invalid, forward to DO if valid
 *
 * Full integration tests should run in @cloudflare/vitest-pool-workers.
 */
describe('Worker Fetch Logic Pattern', () => {
  /**
   * Simulates the worker fetch handler logic without Cloudflare dependencies
   */
  function simulateWorkerFetch(
    url: string,
    mockEnv: {
      idFromName: (name: string) => { id: string }
      get: (id: { id: string }) => { fetch: (req: Request) => Promise<Response> }
    }
  ): { namespace: string; isValid: boolean; response?: Response } {
    const parsedUrl = new URL(url)
    const pathSegment = parsedUrl.pathname.split('/')[1] ?? ''
    const namespace = pathSegment || 'default'

    const isValid = validateNamespace(namespace)

    if (!isValid) {
      return {
        namespace,
        isValid: false,
        response: new Response(
          JSON.stringify({
            error: 'Invalid namespace',
            message: 'Namespace must be 1-64 characters, alphanumeric with hyphens and underscores only',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        ),
      }
    }

    return { namespace, isValid: true }
  }

  describe('namespace extraction and validation', () => {
    it('extracts namespace from first path segment', () => {
      const result = simulateWorkerFetch('https://npmx.do/tenant123/health', {
        idFromName: (name) => ({ id: name }),
        get: () => ({ fetch: async () => new Response() }),
      })

      expect(result.namespace).toBe('tenant123')
      expect(result.isValid).toBe(true)
    })

    it('uses default for empty path', () => {
      const result = simulateWorkerFetch('https://npmx.do/', {
        idFromName: (name) => ({ id: name }),
        get: () => ({ fetch: async () => new Response() }),
      })

      expect(result.namespace).toBe('default')
      expect(result.isValid).toBe(true)
    })

    it('rejects encoded path traversal and returns 400', async () => {
      // Note: new URL() normalizes plain '../' to resolve it, but NOT encoded '%2F'
      // So we test with URL-encoded path traversal which our validator must catch
      const result = simulateWorkerFetch('https://npmx.do/..%2Fadmin/health', {
        idFromName: (name) => ({ id: name }),
        get: () => ({ fetch: async () => new Response() }),
      })

      expect(result.isValid).toBe(false)
      expect(result.response?.status).toBe(400)

      const body = await result.response?.json() as { error: string }
      expect(body.error).toBe('Invalid namespace')
    })

    it('rejects long namespaces and returns 400', async () => {
      const longNs = 'a'.repeat(100)
      const result = simulateWorkerFetch(`https://npmx.do/${longNs}/health`, {
        idFromName: (name) => ({ id: name }),
        get: () => ({ fetch: async () => new Response() }),
      })

      expect(result.isValid).toBe(false)
      expect(result.response?.status).toBe(400)
    })

    it('rejects special characters and returns 400', async () => {
      const result = simulateWorkerFetch('https://npmx.do/foo@bar/health', {
        idFromName: (name) => ({ id: name }),
        get: () => ({ fetch: async () => new Response() }),
      })

      expect(result.isValid).toBe(false)
      expect(result.response?.status).toBe(400)
    })

    it('accepts valid namespace with hyphens', () => {
      const result = simulateWorkerFetch('https://npmx.do/my-company/health', {
        idFromName: (name) => ({ id: name }),
        get: () => ({ fetch: async () => new Response() }),
      })

      expect(result.namespace).toBe('my-company')
      expect(result.isValid).toBe(true)
    })

    it('accepts valid namespace with underscores', () => {
      const result = simulateWorkerFetch('https://npmx.do/my_company/health', {
        idFromName: (name) => ({ id: name }),
        get: () => ({ fetch: async () => new Response() }),
      })

      expect(result.namespace).toBe('my_company')
      expect(result.isValid).toBe(true)
    })
  })
})
