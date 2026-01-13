import { describe, it, expect } from 'vitest'
import { resolveNamespace } from '../resolver'
import type { NamespaceConfig, ResolvedNamespace } from '../resolver'

/**
 * Namespace Resolver Tests
 *
 * Tests for HTTP request namespace resolution supporting three modes:
 * 1. Hostname-only (default): ns = origin
 * 2. Path pattern (e.g., '/:org'): ns = origin + extracted segments
 * 3. Fixed: ns = config.fixed value
 *
 * Coverage areas:
 * - Namespace parsing from various URL formats
 * - Path resolution with remaining segments
 * - Nested namespaces (2-level, 3-level, 4-level)
 * - Collision handling (partial paths, ambiguous segments)
 * - Validation (malformed URLs, edge cases)
 */

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

  // ============================================================================
  // Deep Nested Namespace Resolution (3+ levels)
  // ============================================================================

  describe('deeply nested path param resolution (/:org/:project/:environment)', () => {
    it('extracts three-level path params as namespace', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/staging/tasks')
      const config: NamespaceConfig = { pattern: '/:org/:project/:environment' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1/staging')
      expect(result.path).toBe('/tasks')
    })

    it('extracts three-level params with deeper remaining path', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/prod/tasks/456/comments/789')
      const config: NamespaceConfig = { pattern: '/:org/:project/:env' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1/prod')
      expect(result.path).toBe('/tasks/456/comments/789')
    })

    it('handles three-level namespace-only path', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/staging')
      const config: NamespaceConfig = { pattern: '/:org/:project/:env' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1/staging')
      expect(result.path).toBe('/')
    })
  })

  describe('four-level nested path param resolution', () => {
    it('extracts four-level path params as namespace', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/staging/us-west/resources')
      const config: NamespaceConfig = { pattern: '/:org/:project/:env/:region' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1/staging/us-west')
      expect(result.path).toBe('/resources')
    })

    it('handles four-level namespace with query string', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/prod/eu-central/items?page=2')
      const config: NamespaceConfig = { pattern: '/:org/:project/:env/:region' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1/prod/eu-central')
      expect(result.path).toBe('/items?page=2')
    })
  })

  // ============================================================================
  // Path Resolution Edge Cases
  // ============================================================================

  describe('path resolution edge cases', () => {
    it('handles double slashes in path', () => {
      const request = new Request('https://api.example.org.ai/acme//customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      // Double slash creates empty segment which is filtered out
      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/customers')
    })

    it('handles trailing double slashes', () => {
      const request = new Request('https://api.example.org.ai/acme/customers//')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/customers')
    })

    it('preserves complex query strings', () => {
      const request = new Request('https://api.example.org.ai/acme/search?q=hello+world&filter[status]=active&sort=-created')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/search?q=hello+world&filter[status]=active&sort=-created')
    })

    it('preserves fragment identifier', () => {
      const request = new Request('https://api.example.org.ai/acme/docs/api#authentication')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/docs/api#authentication')
    })

    it('handles query string and fragment together', () => {
      const request = new Request('https://api.example.org.ai/acme/docs?version=2#getting-started')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/docs?version=2#getting-started')
    })

    it('handles URL-encoded path segments correctly', () => {
      const request = new Request('https://api.example.org.ai/my%20org/customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      // URL encoding is preserved
      expect(result.ns).toBe('https://api.example.org.ai/my%20org')
      expect(result.path).toBe('/customers')
    })

    it('handles special characters in namespace segment', () => {
      const request = new Request('https://api.example.org.ai/org-with-dashes/customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/org-with-dashes')
      expect(result.path).toBe('/customers')
    })

    it('handles underscores in namespace segment', () => {
      const request = new Request('https://api.example.org.ai/org_with_underscores/customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/org_with_underscores')
      expect(result.path).toBe('/customers')
    })

    it('handles dots in namespace segment', () => {
      const request = new Request('https://api.example.org.ai/org.v2/customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/org.v2')
      expect(result.path).toBe('/customers')
    })

    it('handles numeric namespace segment', () => {
      const request = new Request('https://api.example.org.ai/12345/customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/12345')
      expect(result.path).toBe('/customers')
    })
  })

  // ============================================================================
  // Collision Handling
  // ============================================================================

  describe('collision handling', () => {
    it('pattern extracts exactly the number of segments specified', () => {
      // With pattern /:org, only first segment is namespace
      const request = new Request('https://api.example.org.ai/acme/proj1/tasks')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      // Only 'acme' is namespace, 'proj1' is part of path
      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/proj1/tasks')
    })

    it('two-level pattern extracts two segments even with more available', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/env/region/tasks')
      const config: NamespaceConfig = { pattern: '/:org/:project' }

      const result = resolveNamespace(request, config)

      // Only 'acme/proj1' is namespace
      expect(result.ns).toBe('https://api.example.org.ai/acme/proj1')
      expect(result.path).toBe('/env/region/tasks')
    })

    it('handles path that looks like namespace pattern segment', () => {
      // Even if remaining path segment matches pattern variable name
      const request = new Request('https://api.example.org.ai/acme/org/project')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/org/project')
    })

    it('same URL different patterns yield different namespaces', () => {
      const url = 'https://api.example.org.ai/a/b/c/d'

      const result1 = resolveNamespace(new Request(url), { pattern: '/:a' })
      const result2 = resolveNamespace(new Request(url), { pattern: '/:a/:b' })
      const result3 = resolveNamespace(new Request(url), { pattern: '/:a/:b/:c' })

      expect(result1.ns).toBe('https://api.example.org.ai/a')
      expect(result1.path).toBe('/b/c/d')

      expect(result2.ns).toBe('https://api.example.org.ai/a/b')
      expect(result2.path).toBe('/c/d')

      expect(result3.ns).toBe('https://api.example.org.ai/a/b/c')
      expect(result3.path).toBe('/d')
    })

    it('fixed namespace overrides URL-based resolution completely', () => {
      const request = new Request('https://api.example.org.ai/acme/proj1/tasks')
      const config: NamespaceConfig = { fixed: 'singleton', pattern: '/:org/:project' }

      const result = resolveNamespace(request, config)

      // Fixed takes precedence, pattern is ignored
      expect(result.ns).toBe('singleton')
      expect(result.path).toBe('/acme/proj1/tasks')
    })
  })

  // ============================================================================
  // Validation and Edge Cases
  // ============================================================================

  describe('validation and edge cases', () => {
    it('handles path with fewer segments than pattern requires', () => {
      // Pattern expects 2 segments but URL only has 1
      const request = new Request('https://api.example.org.ai/acme')
      const config: NamespaceConfig = { pattern: '/:org/:project' }

      const result = resolveNamespace(request, config)

      // Should extract what's available
      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/')
    })

    it('handles empty path with pattern', () => {
      const request = new Request('https://api.example.org.ai/')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      // No segments to extract
      expect(result.ns).toBe('https://api.example.org.ai/')
      expect(result.path).toBe('/')
    })

    it('handles root path with no trailing slash', () => {
      const request = new Request('https://api.example.org.ai')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/')
      expect(result.path).toBe('/')
    })

    it('handles pattern with mixed static and dynamic segments', () => {
      // Pattern with leading static segment (e.g., /api/:org)
      // Note: Current implementation counts params only
      const request = new Request('https://example.org.ai/api/acme/customers')
      const config: NamespaceConfig = { pattern: '/api/:org' }

      const result = resolveNamespace(request, config)

      // Pattern has 1 param, so extracts 1 segment
      expect(result.ns).toBe('https://example.org.ai/api')
      expect(result.path).toBe('/acme/customers')
    })

    it('handles pattern without leading slash', () => {
      const request = new Request('https://api.example.org.ai/acme/customers')
      const config: NamespaceConfig = { pattern: ':org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/acme')
      expect(result.path).toBe('/customers')
    })

    it('handles IPv4 address as host', () => {
      const request = new Request('http://192.168.1.1:8080/acme/customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('http://192.168.1.1:8080/acme')
      expect(result.path).toBe('/customers')
    })

    it('handles IPv6 address as host', () => {
      const request = new Request('http://[::1]:8080/acme/customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('http://[::1]:8080/acme')
      expect(result.path).toBe('/customers')
    })

    it('handles very long path segments', () => {
      const longSegment = 'a'.repeat(1000)
      const request = new Request(`https://api.example.org.ai/${longSegment}/customers`)
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe(`https://api.example.org.ai/${longSegment}`)
      expect(result.path).toBe('/customers')
    })

    it('handles Unicode characters in path', () => {
      const request = new Request('https://api.example.org.ai/%E4%B8%AD%E6%96%87/customers')
      const config: NamespaceConfig = { pattern: '/:org' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.example.org.ai/%E4%B8%AD%E6%96%87')
      expect(result.path).toBe('/customers')
    })
  })

  // ============================================================================
  // Pattern Caching Behavior
  // ============================================================================

  describe('pattern caching', () => {
    it('returns consistent results for same pattern across multiple calls', () => {
      const config: NamespaceConfig = { pattern: '/:org/:project' }

      const result1 = resolveNamespace(
        new Request('https://api.example.org.ai/acme/proj1/tasks'),
        config
      )
      const result2 = resolveNamespace(
        new Request('https://api.example.org.ai/beta/proj2/items'),
        config
      )

      expect(result1.ns).toBe('https://api.example.org.ai/acme/proj1')
      expect(result2.ns).toBe('https://api.example.org.ai/beta/proj2')
    })

    it('different patterns are cached independently', () => {
      const config1: NamespaceConfig = { pattern: '/:a' }
      const config2: NamespaceConfig = { pattern: '/:a/:b' }

      const result1 = resolveNamespace(
        new Request('https://api.example.org.ai/x/y/z'),
        config1
      )
      const result2 = resolveNamespace(
        new Request('https://api.example.org.ai/x/y/z'),
        config2
      )

      expect(result1.ns).toBe('https://api.example.org.ai/x')
      expect(result1.path).toBe('/y/z')

      expect(result2.ns).toBe('https://api.example.org.ai/x/y')
      expect(result2.path).toBe('/z')
    })
  })

  // ============================================================================
  // Real-world Scenarios
  // ============================================================================

  describe('real-world scenarios', () => {
    it('multi-tenant SaaS API routing', () => {
      // Pattern: /:tenant
      const request = new Request('https://api.saas.com/acme-corp/users/123')
      const config: NamespaceConfig = { pattern: '/:tenant' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.saas.com/acme-corp')
      expect(result.path).toBe('/users/123')
    })

    it('GitHub-style organization/repo routing', () => {
      // Pattern: /:owner/:repo
      const request = new Request('https://api.github.com/anthropics/claude/pulls/42')
      const config: NamespaceConfig = { pattern: '/:owner/:repo' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.github.com/anthropics/claude')
      expect(result.path).toBe('/pulls/42')
    })

    it('Cloudflare Workers-style routing with account/namespace', () => {
      // Pattern: /:account/:namespace
      const request = new Request('https://api.cloudflare.com/abc123/my-do/items?limit=10')
      const config: NamespaceConfig = { pattern: '/:account/:namespace' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('https://api.cloudflare.com/abc123/my-do')
      expect(result.path).toBe('/items?limit=10')
    })

    it('dotdo API hostname-based routing', () => {
      // Default mode: hostname is namespace
      const request = new Request('https://tenant.api.dotdo.dev/customers/alice/orders')

      const result = resolveNamespace(request)

      expect(result.ns).toBe('https://tenant.api.dotdo.dev')
      expect(result.path).toBe('/customers/alice/orders')
    })

    it('dotdo singleton DO routing', () => {
      // Fixed namespace for singleton
      const request = new Request('https://api.dotdo.dev/v1/health')
      const config: NamespaceConfig = { fixed: 'system' }

      const result = resolveNamespace(request, config)

      expect(result.ns).toBe('system')
      expect(result.path).toBe('/v1/health')
    })
  })
})
