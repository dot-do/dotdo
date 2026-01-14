import { describe, it, expect } from 'vitest'
import { findRoute, type Route } from '../../proxy'

/**
 * Route Matching Tests (GREEN Phase)
 *
 * Tests for route matching logic in the proxy snippet.
 */

describe('Route Matching', () => {
  it('matches exact path', () => {
    const routes: Route[] = [
      {
        id: 'exact',
        match: { path: '^/api/users$' },
      },
    ]

    const url = new URL('https://example.com.ai/api/users')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('exact')
  })

  it('matches regex path pattern', () => {
    const routes: Route[] = [
      {
        id: 'regex',
        match: { path: '^/api/users/[0-9]+$' },
      },
    ]

    const url = new URL('https://example.com.ai/api/users/123')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('regex')
  })

  it('matches path with wildcard', () => {
    const routes: Route[] = [
      {
        id: 'wildcard',
        match: { path: '^/api/.*' },
      },
    ]

    const url = new URL('https://example.com.ai/api/anything/here')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('wildcard')
  })

  it('filters by HTTP method', () => {
    const routes: Route[] = [
      {
        id: 'post-only',
        match: { path: '^/api/create$', methods: ['POST'] },
      },
    ]

    const url = new URL('https://example.com.ai/api/create')

    const getRoute = findRoute(url, 'GET', routes)
    expect(getRoute).toBeNull()

    const postRoute = findRoute(url, 'POST', routes)
    expect(postRoute?.id).toBe('post-only')
  })

  it('respects route priority ordering', () => {
    const routes: Route[] = [
      {
        id: 'low-priority',
        priority: 1,
        match: { path: '^/api/.*' },
      },
      {
        id: 'high-priority',
        priority: 100,
        match: { path: '^/api/users$' },
      },
    ]

    const url = new URL('https://example.com.ai/api/users')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('high-priority')
  })

  it('falls through to null when no match', () => {
    const routes: Route[] = [
      {
        id: 'api-only',
        match: { path: '^/api/.*' },
      },
    ]

    const url = new URL('https://example.com.ai/other/path')
    const route = findRoute(url, 'GET', routes)

    expect(route).toBeNull()
  })

  it('handles disabled routes (enabled: false)', () => {
    const routes: Route[] = [
      {
        id: 'disabled',
        enabled: false,
        match: { path: '^/api/disabled$' },
      },
      {
        id: 'enabled',
        match: { path: '^/api/.*' },
      },
    ]

    const url = new URL('https://example.com.ai/api/disabled')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('enabled')
  })

  it('matches multiple methods', () => {
    const routes: Route[] = [
      {
        id: 'crud',
        match: { path: '^/api/items$', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
      },
    ]

    const url = new URL('https://example.com.ai/api/items')

    expect(findRoute(url, 'GET', routes)?.id).toBe('crud')
    expect(findRoute(url, 'POST', routes)?.id).toBe('crud')
    expect(findRoute(url, 'PUT', routes)?.id).toBe('crud')
    expect(findRoute(url, 'DELETE', routes)?.id).toBe('crud')
    expect(findRoute(url, 'PATCH', routes)).toBeNull()
  })

  it('handles routes without methods (matches all)', () => {
    const routes: Route[] = [
      {
        id: 'any-method',
        match: { path: '^/api/any$' },
      },
    ]

    const url = new URL('https://example.com.ai/api/any')

    expect(findRoute(url, 'GET', routes)?.id).toBe('any-method')
    expect(findRoute(url, 'POST', routes)?.id).toBe('any-method')
    expect(findRoute(url, 'DELETE', routes)?.id).toBe('any-method')
  })

  it('handles empty routes array', () => {
    const url = new URL('https://example.com.ai/api/test')
    const route = findRoute(url, 'GET', [])

    expect(route).toBeNull()
  })

  it('handles undefined routes array', () => {
    const url = new URL('https://example.com.ai/api/test')
    const route = findRoute(url, 'GET', undefined as unknown as Route[])

    expect(route).toBeNull()
  })

  it('sorts routes by priority descending', () => {
    const routes: Route[] = [
      { id: 'p0', match: { path: '^/test$' } },
      { id: 'p10', priority: 10, match: { path: '^/test$' } },
      { id: 'p5', priority: 5, match: { path: '^/test$' } },
    ]

    const url = new URL('https://example.com.ai/test')
    const route = findRoute(url, 'GET', routes)

    expect(route?.id).toBe('p10')
  })
})
