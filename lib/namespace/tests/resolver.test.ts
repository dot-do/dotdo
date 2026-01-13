import { describe, it, expect } from 'vitest'
import { resolveNamespace } from '../resolver'
import type { NamespaceConfig, ResolvedNamespace } from '../resolver'

describe('resolveNamespace', () => {
  describe('hostname-only resolution (no pattern config)', () => {
    it('extracts namespace from subdomain hostname', () => {
      const request = new Request('https://tenant.api.example.org.ai/customers')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('https://tenant.api.example.org.ai')
      expect(result.path).toBe('/customers')
    })

    it('extracts namespace with nested path', () => {
      const request = new Request('https://tenant.api.example.org.ai/customers/123/orders')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('https://tenant.api.example.org.ai')
      expect(result.path).toBe('/customers/123/orders')
    })

    it('handles root path', () => {
      const request = new Request('https://tenant.api.example.org.ai/')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('https://tenant.api.example.org.ai')
      expect(result.path).toBe('/')
    })

    it('handles empty path', () => {
      const request = new Request('https://tenant.api.example.org.ai')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('https://tenant.api.example.org.ai')
      expect(result.path).toBe('/')
    })
  })

  describe('path param resolution (/:org pattern)', () => {
    it('extracts single path param as namespace', () => {
      const request = new Request('https://api.example.org.ai/acme/customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/customers')
    })

    it('extracts org with nested remaining path', () => {
      const request = new Request('https://api.example.org.ai/acme/customers/123/orders')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/customers/123/orders')
    })

    it('handles org-only path with trailing slash', () => {
      const request = new Request('https://api.example.org.ai/acme/')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/')
    })

    it('handles org-only path without trailing slash', () => {
      const request = new Request('https://api.example.org.ai/acme')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/')
    })
  })

  describe('nested path param resolution (/:org/:project pattern)', () => {
    it('extracts nested path params as colon-separated namespace', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/tasks')
      const config: NamespaceConfig = { pattern: '/:org/:project' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1')
      expect(result.path).toBe('/tasks')
    })

    it('extracts nested params with deeper remaining path', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/tasks/456/comments')
      const config: NamespaceConfig = { pattern: '/:org/:project' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1')
      expect(result.path).toBe('/tasks/456/comments')
    })

    it('handles namespace-only path with trailing slash', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/')
      const config: NamespaceConfig = { pattern: '/:org/:project' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1')
      expect(result.path).toBe('/')
    })

    it('handles namespace-only path without trailing slash', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1')
      const config: NamespaceConfig = { pattern: '/:org/:project' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1')
      expect(result.path).toBe('/')
    })
  })

  describe('fixed namespace resolution', () => {
    it('returns fixed namespace regardless of request URL', () => {
      const request = new Request('https://api.example.org.ai/anything/here')
      const config: NamespaceConfig = { fixed: 'main' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('main')
      expect(result.path).toBe('/anything/here')
    })

    it('returns fixed namespace for root path', () => {
      const request = new Request('https://api.example.org.ai/')
      const config: NamespaceConfig = { fixed: 'main' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('main')
      expect(result.path).toBe('/')
    })

    it('returns fixed namespace for different hosts', () => {
      const request = new Request('https://other.domain.com/some/path')
      const config: NamespaceConfig = { fixed: 'singleton' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('singleton')
      expect(result.path).toBe('/some/path')
    })

    it('fixed takes precedence over pattern', () => {
      const request = new Request('https://api.example.org.ai/acme/customers')
      const config: NamespaceConfig = { pattern: '/:org', fixed: 'override' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('override')
      expect(result.path).toBe('/acme/customers')
    })
  })

  describe('remaining path extraction', () => {
    it('preserves query string in remaining path', () => {
      const request = new Request('https://tenant.api.example.org.ai/customers?page=1&limit=10')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('https://tenant.api.example.org.ai')
      expect(result.path).toBe('/customers?page=1&limit=10')
    })

    it('preserves query string with path param pattern', () => {
      const request = new Request('https://api.example.org.ai/acme/customers?active=true')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/customers?active=true')
    })

    it('preserves hash fragment in remaining path', () => {
      const request = new Request('https://tenant.api.example.org.ai/docs#section-1')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('https://tenant.api.example.org.ai')
      expect(result.path).toBe('/docs#section-1')
    })

    it('handles special characters in path segments', () => {
      const request = new Request('https://api.example.org.ai/my-org/resource%20name')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/my-org')
      expect(result.path).toBe('/resource%20name')
    })
  })

  describe('edge cases', () => {
    it('handles HTTP protocol', () => {
      const request = new Request('http://tenant.api.example.org.ai/customers')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('http://tenant.api.example.org.ai')
      expect(result.path).toBe('/customers')
    })

    it('handles custom port', () => {
      const request = new Request('https://tenant.api.example.org.ai:8080/customers')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('https://tenant.api.example.org.ai:8080')
      expect(result.path).toBe('/customers')
    })

    it('handles localhost', () => {
      const request = new Request('http://localhost:3000/customers')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('http://localhost:3000')
      expect(result.path).toBe('/customers')
    })

    it('handles empty config object', () => {
      const request = new Request('https://tenant.api.example.org.ai/customers')
      const config: NamespaceConfig = {}

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://tenant.api.example.org.ai')
      expect(result.path).toBe('/customers')
    })
  })
})
