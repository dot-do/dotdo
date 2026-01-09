import { describe, it, expect } from 'vitest'
import { findRoute, type Route, type ProxyConfig } from '../proxy'

/**
 * Route Matching Tests (RED Phase)
 *
 * The proxy snippet matches incoming requests against configured routes.
 * Routes can match on:
 * - Path (exact, regex, wildcard)
 * - HTTP method
 * - Headers
 *
 * Routes are sorted by priority (higher = first match).
 * First matching route wins.
 *
 * These tests are expected to FAIL until the proxy snippet is implemented.
 */

// ============================================================================
// Test Fixtures
// ============================================================================

const BASE_ROUTE: Route = {
  id: 'test-route',
  match: {
    path: '^/api/test',
  },
  target: { type: 'passthrough' },
}

function createTestRoute(overrides: Partial<Route> = {}): Route {
  return { ...BASE_ROUTE, ...overrides }
}

function createTestUrl(path: string): URL {
  return new URL(`https://example.com${path}`)
}

// ============================================================================
// Path Matching Tests
// ============================================================================

describe('Route Matching - Path', () => {
  it('matches exact path', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'exact',
        match: { path: '^/api/users$' },
      }),
    ]

    const url = createTestUrl('/api/users')
    const route = findRoute(url, 'GET', routes)

    expect(route).toBeDefined()
    expect(route?.id).toBe('exact')
  })

  it('does not match different path on exact match', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'exact',
        match: { path: '^/api/users$' },
      }),
    ]

    const url = createTestUrl('/api/customers')
    const route = findRoute(url, 'GET', routes)

    expect(route).toBeNull()
  })

  it('matches regex path pattern', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'regex',
        match: { path: '^/api/v[0-9]+/users' },
      }),
    ]

    // Should match v1
    const url1 = createTestUrl('/api/v1/users')
    expect(findRoute(url1, 'GET', routes)?.id).toBe('regex')

    // Should match v2
    const url2 = createTestUrl('/api/v2/users')
    expect(findRoute(url2, 'GET', routes)?.id).toBe('regex')

    // Should match v99
    const url3 = createTestUrl('/api/v99/users')
    expect(findRoute(url3, 'GET', routes)?.id).toBe('regex')
  })

  it('matches path with wildcard', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'wildcard',
        match: { path: '^/api/.*' },
      }),
    ]

    // Should match any path under /api/
    expect(findRoute(createTestUrl('/api/users'), 'GET', routes)?.id).toBe('wildcard')
    expect(findRoute(createTestUrl('/api/users/123'), 'GET', routes)?.id).toBe('wildcard')
    expect(findRoute(createTestUrl('/api/deeply/nested/path'), 'GET', routes)?.id).toBe('wildcard')
  })

  it('matches path with capture groups', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'capture',
        match: { path: '^/api/users/([0-9]+)' },
      }),
    ]

    // Should match user IDs
    expect(findRoute(createTestUrl('/api/users/123'), 'GET', routes)?.id).toBe('capture')
    expect(findRoute(createTestUrl('/api/users/456'), 'GET', routes)?.id).toBe('capture')

    // Should not match non-numeric
    expect(findRoute(createTestUrl('/api/users/abc'), 'GET', routes)).toBeNull()
  })

  it('does not match path prefix without start anchor', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'no-anchor',
        match: { path: '/api/users' }, // Missing ^ anchor
      }),
    ]

    // Without ^ anchor, might match anywhere in path
    // This depends on implementation - regex.test() matches anywhere
    const url = createTestUrl('/prefix/api/users')
    const route = findRoute(url, 'GET', routes)

    // Expected behavior: should NOT match because path doesn't START with /api/users
    // Implementation should add implicit ^ if not present, or document behavior
    expect(route).toBeNull()
  })

  it('matches path with optional trailing slash', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'optional-slash',
        match: { path: '^/api/users/?$' },
      }),
    ]

    // Should match with and without trailing slash
    expect(findRoute(createTestUrl('/api/users'), 'GET', routes)?.id).toBe('optional-slash')
    expect(findRoute(createTestUrl('/api/users/'), 'GET', routes)?.id).toBe('optional-slash')
  })
})

// ============================================================================
// HTTP Method Filtering Tests
// ============================================================================

describe('Route Matching - HTTP Methods', () => {
  it('filters by HTTP method', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'get-only',
        match: { path: '^/api/users', methods: ['GET'] },
      }),
    ]

    // GET should match
    expect(findRoute(createTestUrl('/api/users'), 'GET', routes)?.id).toBe('get-only')

    // POST should not match
    expect(findRoute(createTestUrl('/api/users'), 'POST', routes)).toBeNull()
  })

  it('matches multiple methods', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'crud',
        match: { path: '^/api/users', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      }),
    ]

    // All specified methods should match
    expect(findRoute(createTestUrl('/api/users'), 'GET', routes)?.id).toBe('crud')
    expect(findRoute(createTestUrl('/api/users'), 'POST', routes)?.id).toBe('crud')
    expect(findRoute(createTestUrl('/api/users'), 'PUT', routes)?.id).toBe('crud')
    expect(findRoute(createTestUrl('/api/users'), 'DELETE', routes)?.id).toBe('crud')

    // PATCH should not match
    expect(findRoute(createTestUrl('/api/users'), 'PATCH', routes)).toBeNull()
  })

  it('matches all methods when not specified', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'all-methods',
        match: { path: '^/api/users' }, // No methods specified
      }),
    ]

    // All methods should match
    expect(findRoute(createTestUrl('/api/users'), 'GET', routes)?.id).toBe('all-methods')
    expect(findRoute(createTestUrl('/api/users'), 'POST', routes)?.id).toBe('all-methods')
    expect(findRoute(createTestUrl('/api/users'), 'PUT', routes)?.id).toBe('all-methods')
    expect(findRoute(createTestUrl('/api/users'), 'DELETE', routes)?.id).toBe('all-methods')
    expect(findRoute(createTestUrl('/api/users'), 'PATCH', routes)?.id).toBe('all-methods')
    expect(findRoute(createTestUrl('/api/users'), 'OPTIONS', routes)?.id).toBe('all-methods')
  })

  it('handles case-insensitive method matching', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'get',
        match: { path: '^/api/users', methods: ['GET'] },
      }),
    ]

    // Should match regardless of case
    expect(findRoute(createTestUrl('/api/users'), 'GET', routes)?.id).toBe('get')
    expect(findRoute(createTestUrl('/api/users'), 'get', routes)?.id).toBe('get')
    expect(findRoute(createTestUrl('/api/users'), 'Get', routes)?.id).toBe('get')
  })
})

// ============================================================================
// Route Priority Tests
// ============================================================================

describe('Route Matching - Priority', () => {
  it('respects route priority ordering', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'low-priority',
        priority: 10,
        match: { path: '^/api/.*' },
      }),
      createTestRoute({
        id: 'high-priority',
        priority: 100,
        match: { path: '^/api/users' },
      }),
    ]

    // High priority route should match first
    const url = createTestUrl('/api/users')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('high-priority')
  })

  it('uses default priority of 0 when not specified', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'default-priority',
        // priority not specified, should default to 0
        match: { path: '^/api/users' },
      }),
      createTestRoute({
        id: 'explicit-priority',
        priority: 1,
        match: { path: '^/api/users' },
      }),
    ]

    // Explicit priority 1 should win over default 0
    const route = findRoute(createTestUrl('/api/users'), 'GET', routes)
    expect(route?.id).toBe('explicit-priority')
  })

  it('returns first match when priorities are equal', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'first',
        priority: 50,
        match: { path: '^/api/users' },
      }),
      createTestRoute({
        id: 'second',
        priority: 50,
        match: { path: '^/api/users' },
      }),
    ]

    // First route in sorted order should win
    const route = findRoute(createTestUrl('/api/users'), 'GET', routes)
    // Order might depend on stable sort - just verify we get a match
    expect(route).toBeDefined()
    expect(['first', 'second']).toContain(route?.id)
  })

  it('handles negative priorities', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'negative',
        priority: -10,
        match: { path: '^/api/users' },
      }),
      createTestRoute({
        id: 'default',
        // priority defaults to 0
        match: { path: '^/api/users' },
      }),
    ]

    // Default (0) should win over negative (-10)
    const route = findRoute(createTestUrl('/api/users'), 'GET', routes)
    expect(route?.id).toBe('default')
  })
})

// ============================================================================
// Passthrough and Fallback Tests
// ============================================================================

describe('Route Matching - Fallback', () => {
  it('falls through to passthrough when no match', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'api-users',
        match: { path: '^/api/users' },
      }),
    ]

    // Request to non-matching path
    const route = findRoute(createTestUrl('/other/path'), 'GET', routes)

    // Should return null, allowing passthrough
    expect(route).toBeNull()
  })

  it('returns null for empty routes array', () => {
    const route = findRoute(createTestUrl('/api/users'), 'GET', [])
    expect(route).toBeNull()
  })
})

// ============================================================================
// Disabled Routes Tests
// ============================================================================

describe('Route Matching - Disabled Routes', () => {
  it('handles disabled routes (enabled: false)', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'disabled',
        enabled: false,
        match: { path: '^/api/users' },
      }),
      createTestRoute({
        id: 'enabled',
        enabled: true,
        match: { path: '^/api/users' },
      }),
    ]

    // Should skip disabled route and match enabled one
    const route = findRoute(createTestUrl('/api/users'), 'GET', routes)
    expect(route?.id).toBe('enabled')
  })

  it('skips all disabled routes', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'disabled1',
        enabled: false,
        match: { path: '^/api/users' },
      }),
      createTestRoute({
        id: 'disabled2',
        enabled: false,
        match: { path: '^/api/users' },
      }),
    ]

    // No enabled routes, should return null
    const route = findRoute(createTestUrl('/api/users'), 'GET', routes)
    expect(route).toBeNull()
  })

  it('treats undefined enabled as true', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'implicit-enabled',
        // enabled not specified, should be treated as true
        match: { path: '^/api/users' },
      }),
    ]

    const route = findRoute(createTestUrl('/api/users'), 'GET', routes)
    expect(route?.id).toBe('implicit-enabled')
  })
})

// ============================================================================
// Header Matching Tests
// ============================================================================

describe('Route Matching - Headers', () => {
  it('matches header conditions', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'api-key-route',
        match: {
          path: '^/api/users',
          headers: {
            'X-API-Key': '.*', // Any value
          },
        },
      }),
    ]

    // Create mock request with headers
    const url = createTestUrl('/api/users')
    const headersWithKey = new Headers({ 'X-API-Key': 'secret123' })
    const headersWithoutKey = new Headers({})

    // With header - should match
    const routeWithHeader = findRoute(url, 'GET', routes, headersWithKey)
    expect(routeWithHeader?.id).toBe('api-key-route')

    // Without header - should not match
    const routeWithoutHeader = findRoute(url, 'GET', routes, headersWithoutKey)
    expect(routeWithoutHeader).toBeNull()
  })

  it('matches specific header values', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'json-only',
        match: {
          path: '^/api/users',
          headers: {
            'Content-Type': 'application/json',
          },
        },
      }),
    ]

    const url = createTestUrl('/api/users')

    // JSON content type - should match
    const jsonHeaders = new Headers({ 'Content-Type': 'application/json' })
    expect(findRoute(url, 'POST', routes, jsonHeaders)?.id).toBe('json-only')

    // XML content type - should not match
    const xmlHeaders = new Headers({ 'Content-Type': 'application/xml' })
    expect(findRoute(url, 'POST', routes, xmlHeaders)).toBeNull()
  })

  it('matches header values with regex', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'json-types',
        match: {
          path: '^/api/users',
          headers: {
            'Content-Type': '^application/.*json.*$',
          },
        },
      }),
    ]

    const url = createTestUrl('/api/users')

    // Various JSON content types
    expect(findRoute(url, 'POST', routes, new Headers({ 'Content-Type': 'application/json' }))?.id).toBe('json-types')
    expect(findRoute(url, 'POST', routes, new Headers({ 'Content-Type': 'application/json; charset=utf-8' }))?.id).toBe(
      'json-types'
    )
    expect(findRoute(url, 'POST', routes, new Headers({ 'Content-Type': 'application/vnd.api+json' }))?.id).toBe(
      'json-types'
    )
  })

  it('matches multiple header conditions (AND)', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'multi-header',
        match: {
          path: '^/api/users',
          headers: {
            'X-API-Key': '.*',
            'Content-Type': 'application/json',
          },
        },
      }),
    ]

    const url = createTestUrl('/api/users')

    // Both headers present - should match
    const bothHeaders = new Headers({
      'X-API-Key': 'secret',
      'Content-Type': 'application/json',
    })
    expect(findRoute(url, 'POST', routes, bothHeaders)?.id).toBe('multi-header')

    // Only one header - should not match
    const onlyApiKey = new Headers({ 'X-API-Key': 'secret' })
    expect(findRoute(url, 'POST', routes, onlyApiKey)).toBeNull()

    const onlyContentType = new Headers({ 'Content-Type': 'application/json' })
    expect(findRoute(url, 'POST', routes, onlyContentType)).toBeNull()
  })

  it('handles case-insensitive header names', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'case-insensitive',
        match: {
          path: '^/api/users',
          headers: {
            'X-API-Key': '.*',
          },
        },
      }),
    ]

    const url = createTestUrl('/api/users')

    // Different cases should all match
    expect(findRoute(url, 'GET', routes, new Headers({ 'X-API-Key': 'val' }))?.id).toBe('case-insensitive')
    expect(findRoute(url, 'GET', routes, new Headers({ 'x-api-key': 'val' }))?.id).toBe('case-insensitive')
    expect(findRoute(url, 'GET', routes, new Headers({ 'X-Api-Key': 'val' }))?.id).toBe('case-insensitive')
  })
})

// ============================================================================
// Query String Tests
// ============================================================================

describe('Route Matching - Query Strings', () => {
  it('matches path ignoring query string', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'api-users',
        match: { path: '^/api/users$' },
      }),
    ]

    // Query string should be ignored for path matching
    const url = createTestUrl('/api/users?page=1&limit=10')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('api-users')
  })

  it('can include query params in match via headers or custom logic', () => {
    // This test documents that query param matching might be implemented
    // via a different mechanism (e.g., custom match conditions)
    const routes: Route[] = [
      createTestRoute({
        id: 'with-query-match',
        match: {
          path: '^/api/search',
          // Query matching could be implemented in future
        },
      }),
    ]

    const url = createTestUrl('/api/search?q=test')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('with-query-match')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Route Matching - Edge Cases', () => {
  it('handles special regex characters in path', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'special-chars',
        match: { path: '^/api/v1\\.0/users' }, // Escaped dot
      }),
    ]

    // Literal v1.0 should match
    expect(findRoute(createTestUrl('/api/v1.0/users'), 'GET', routes)?.id).toBe('special-chars')

    // v1X0 should not match (unescaped dot would match any char)
    expect(findRoute(createTestUrl('/api/v1X0/users'), 'GET', routes)).toBeNull()
  })

  it('handles URL-encoded paths', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'encoded',
        match: { path: '^/api/users/[^/]+' },
      }),
    ]

    // URL-encoded characters in path
    const url = createTestUrl('/api/users/john%20doe')
    const route = findRoute(url, 'GET', routes)

    expect(route).toBeDefined()
  })

  it('handles empty path', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'root',
        match: { path: '^/$' },
      }),
    ]

    const url = createTestUrl('/')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('root')
  })

  it('handles very long paths', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'wildcard',
        match: { path: '^/api/.*' },
      }),
    ]

    const longPath = '/api/' + 'segment/'.repeat(100) + 'end'
    const url = createTestUrl(longPath)
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('wildcard')
  })

  it('handles routes with no id (should still work)', () => {
    const routes: Route[] = [
      {
        // id is optional for matching purposes
        match: { path: '^/api/users' },
        target: { type: 'passthrough' },
      } as Route,
    ]

    const route = findRoute(createTestUrl('/api/users'), 'GET', routes)
    expect(route).toBeDefined()
  })

  it('handles invalid regex gracefully', () => {
    const routes: Route[] = [
      createTestRoute({
        id: 'invalid-regex',
        match: { path: '^/api/users[' }, // Invalid regex (unclosed bracket)
      }),
      createTestRoute({
        id: 'valid',
        match: { path: '^/api/customers' },
      }),
    ]

    // Should not throw, should skip invalid route or handle gracefully
    expect(() => findRoute(createTestUrl('/api/users'), 'GET', routes)).not.toThrow()

    // Valid route should still match
    const route = findRoute(createTestUrl('/api/customers'), 'GET', routes)
    expect(route?.id).toBe('valid')
  })
})
