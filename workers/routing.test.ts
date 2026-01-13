/**
 * Routing Module Unit Tests
 *
 * Tests for namespace resolution, DO binding utilities, and request forwarding.
 * These are pure function tests that don't require Miniflare.
 *
 * @module workers/routing.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  hasSubdomain,
  resolveHostnameNamespace,
  resolvePathNamespace,
  extractPathParams,
  resolveNamespace,
  resolveApiNamespace,
  findDOBinding,
  getDOStub,
  getForwardPath,
  createForwardRequest,
  errorResponse,
  notFoundResponse,
  serviceUnavailableResponse,
} from './routing'
import type { ProxyConfig } from './types'

// =============================================================================
// hasSubdomain Tests
// =============================================================================

describe('hasSubdomain', () => {
  it('returns true for 4-part hostname (subdomain present)', () => {
    expect(hasSubdomain('tenant.api.dotdo.dev')).toBe(true)
  })

  it('returns true for 5-part hostname (multiple subdomains)', () => {
    expect(hasSubdomain('deep.tenant.api.dotdo.dev')).toBe(true)
  })

  it('returns false for 3-part hostname (apex)', () => {
    expect(hasSubdomain('api.dotdo.dev')).toBe(false)
  })

  it('returns false for 2-part hostname (domain only)', () => {
    expect(hasSubdomain('dotdo.dev')).toBe(false)
  })

  it('returns false for localhost (1 part)', () => {
    expect(hasSubdomain('localhost')).toBe(false)
  })

  it('handles empty string', () => {
    expect(hasSubdomain('')).toBe(false)
  })
})

// =============================================================================
// resolveHostnameNamespace Tests
// =============================================================================

describe('resolveHostnameNamespace', () => {
  it('extracts single subdomain from matching host', () => {
    const result = resolveHostnameNamespace('tenant.api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBe('tenant')
  })

  it('extracts subdomain with hyphens', () => {
    const result = resolveHostnameNamespace('my-tenant.api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBe('my-tenant')
  })

  it('extracts subdomain with numbers', () => {
    const result = resolveHostnameNamespace('tenant123.api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBe('tenant123')
  })

  it('extracts multiple levels when specified', () => {
    const result = resolveHostnameNamespace('foo.bar.api.dotdo.dev', 'api.dotdo.dev', 2)
    expect(result).toBe('foo.bar')
  })

  it('returns null for apex domain (no subdomain)', () => {
    const result = resolveHostnameNamespace('api.dotdo.dev', 'api.dotdo.dev')
    expect(result).toBeNull()
  })

  it('returns null for non-matching domain', () => {
    const result = resolveHostnameNamespace('tenant.other.com', 'api.dotdo.dev')
    expect(result).toBeNull()
  })

  it('returns null for partial match', () => {
    const result = resolveHostnameNamespace('dotdo.dev', 'api.dotdo.dev')
    expect(result).toBeNull()
  })

  it('handles deeply nested subdomains with single level extraction', () => {
    const result = resolveHostnameNamespace('a.b.c.api.dotdo.dev', 'api.dotdo.dev', 1)
    expect(result).toBe('a')
  })

  it('handles deeply nested subdomains with multi-level extraction', () => {
    const result = resolveHostnameNamespace('a.b.c.api.dotdo.dev', 'api.dotdo.dev', 3)
    expect(result).toBe('a.b.c')
  })
})

// =============================================================================
// resolvePathNamespace Tests
// =============================================================================

describe('resolvePathNamespace', () => {
  it('extracts single path segment as namespace', () => {
    const result = resolvePathNamespace('/tenant/users', 1)
    expect(result.ns).toBe('tenant')
    expect(result.remainingPath).toBe('/users')
  })

  it('extracts multiple path segments joined by colon', () => {
    const result = resolvePathNamespace('/org/project/tasks', 2)
    expect(result.ns).toBe('org:project')
    expect(result.remainingPath).toBe('/tasks')
  })

  it('returns null ns for empty path', () => {
    const result = resolvePathNamespace('/', 1)
    expect(result.ns).toBeNull()
    expect(result.remainingPath).toBe('/')
  })

  it('returns null ns when not enough segments', () => {
    const result = resolvePathNamespace('/single', 2)
    expect(result.ns).toBeNull()
    expect(result.remainingPath).toBe('/single')
  })

  it('handles path with exact number of segments as params', () => {
    const result = resolvePathNamespace('/org', 1)
    expect(result.ns).toBe('org')
    expect(result.remainingPath).toBe('/')
  })

  it('handles deeply nested path', () => {
    const result = resolvePathNamespace('/a/b/c/d/e', 1)
    expect(result.ns).toBe('a')
    expect(result.remainingPath).toBe('/b/c/d/e')
  })

  it('handles hyphens in path segments', () => {
    const result = resolvePathNamespace('/my-org/my-project/tasks', 2)
    expect(result.ns).toBe('my-org:my-project')
    expect(result.remainingPath).toBe('/tasks')
  })
})

// =============================================================================
// extractPathParams Tests
// =============================================================================

describe('extractPathParams', () => {
  it('extracts single path param namespace as URL', () => {
    const url = new URL('https://api.dotdo.dev/acme/users')
    const result = extractPathParams(url, '/:org')
    expect(result.ns).toBe('https://api.dotdo.dev/acme')
    expect(result.remainingPath).toBe('/users')
  })

  it('extracts nested path params namespace as URL', () => {
    const url = new URL('https://api.dotdo.dev/acme/proj1/tasks')
    const result = extractPathParams(url, '/:org/:project')
    expect(result.ns).toBe('https://api.dotdo.dev/acme/proj1')
    expect(result.remainingPath).toBe('/tasks')
  })

  it('returns null ns when not enough path segments', () => {
    const url = new URL('https://api.dotdo.dev/acme')
    const result = extractPathParams(url, '/:org/:project')
    expect(result.ns).toBeNull()
    expect(result.remainingPath).toBe('/acme')
  })

  it('handles root path after namespace extraction', () => {
    const url = new URL('https://api.dotdo.dev/acme')
    const result = extractPathParams(url, '/:org')
    expect(result.ns).toBe('https://api.dotdo.dev/acme')
    expect(result.remainingPath).toBe('/')
  })

  it('handles trailing slash', () => {
    const url = new URL('https://api.dotdo.dev/acme/')
    const result = extractPathParams(url, '/:org')
    expect(result.ns).toBe('https://api.dotdo.dev/acme')
    expect(result.remainingPath).toBe('/')
  })

  it('handles path with query params (ignores them)', () => {
    const url = new URL('https://api.dotdo.dev/acme/users?filter=active')
    const result = extractPathParams(url, '/:org')
    expect(result.ns).toBe('https://api.dotdo.dev/acme')
    expect(result.remainingPath).toBe('/users')
  })

  it('handles deeply nested remaining path', () => {
    const url = new URL('https://api.dotdo.dev/acme/users/123/profile/settings')
    const result = extractPathParams(url, '/:org')
    expect(result.ns).toBe('https://api.dotdo.dev/acme')
    expect(result.remainingPath).toBe('/users/123/profile/settings')
  })
})

// =============================================================================
// resolveNamespace Tests
// =============================================================================

describe('resolveNamespace', () => {
  describe('fixed mode', () => {
    it('returns fixed namespace', () => {
      const config: ProxyConfig = {
        mode: 'fixed',
        fixed: { namespace: 'main' },
      }
      const request = new Request('https://api.dotdo.dev/users')
      const result = resolveNamespace(request, config)
      expect(result.ns).toBe('main')
      expect(result.remainingPath).toBe('/users')
    })

    it('returns null when fixed namespace not configured', () => {
      const config: ProxyConfig = { mode: 'fixed' }
      const request = new Request('https://api.dotdo.dev/users')
      const result = resolveNamespace(request, config)
      expect(result.ns).toBeNull()
    })
  })

  describe('hostname mode', () => {
    it('extracts namespace from subdomain', () => {
      const config: ProxyConfig = {
        mode: 'hostname',
        hostname: { rootDomain: 'api.dotdo.dev' },
      }
      const request = new Request('https://tenant.api.dotdo.dev/users')
      const result = resolveNamespace(request, config)
      expect(result.ns).toBe('tenant')
      expect(result.remainingPath).toBe('/users')
    })

    it('returns defaultNs for apex domain', () => {
      const config: ProxyConfig = {
        mode: 'hostname',
        hostname: { rootDomain: 'api.dotdo.dev' },
        defaultNs: 'default',
      }
      const request = new Request('https://api.dotdo.dev/users')
      const result = resolveNamespace(request, config)
      expect(result.ns).toBe('default')
    })

    it('returns null for apex domain without defaultNs', () => {
      const config: ProxyConfig = {
        mode: 'hostname',
        hostname: { rootDomain: 'api.dotdo.dev' },
      }
      const request = new Request('https://api.dotdo.dev/users')
      const result = resolveNamespace(request, config)
      expect(result.ns).toBeNull()
    })
  })

  describe('path mode', () => {
    it('extracts namespace from first path segment', () => {
      const config: ProxyConfig = { mode: 'path' }
      const request = new Request('https://api.dotdo.dev/tenant/users')
      const result = resolveNamespace(request, config)
      expect(result.ns).toBe('tenant')
      expect(result.remainingPath).toBe('/users')
    })

    it('strips basepath before extraction', () => {
      const config: ProxyConfig = {
        mode: 'path',
        basepath: '/api/v1',
      }
      const request = new Request('https://api.dotdo.dev/api/v1/tenant/users')
      const result = resolveNamespace(request, config)
      expect(result.ns).toBe('tenant')
      expect(result.remainingPath).toBe('/users')
    })

    it('returns defaultNs for root path', () => {
      const config: ProxyConfig = {
        mode: 'path',
        defaultNs: 'default',
      }
      const request = new Request('https://api.dotdo.dev/')
      const result = resolveNamespace(request, config)
      expect(result.ns).toBe('default')
    })

    it('returns null for root path without defaultNs', () => {
      const config: ProxyConfig = { mode: 'path' }
      const request = new Request('https://api.dotdo.dev/')
      const result = resolveNamespace(request, config)
      expect(result.ns).toBeNull()
    })
  })
})

// =============================================================================
// resolveApiNamespace Tests
// =============================================================================

describe('resolveApiNamespace', () => {
  it('uses hostname mode when no pattern provided', () => {
    const request = new Request('https://tenant.api.dotdo.dev/users')
    const result = resolveApiNamespace(request)
    expect(result.ns).toBe('https://tenant.api.dotdo.dev')
    expect(result.remainingPath).toBe('/users')
  })

  it('returns null for apex domain in hostname mode', () => {
    const request = new Request('https://api.dotdo.dev/users')
    const result = resolveApiNamespace(request)
    expect(result.ns).toBeNull()
  })

  it('returns literal for fixed pattern', () => {
    const request = new Request('https://api.dotdo.dev/users')
    const result = resolveApiNamespace(request, 'main')
    expect(result.ns).toBe('main')
    expect(result.remainingPath).toBe('/users')
  })

  it('extracts path params for pattern', () => {
    const request = new Request('https://api.dotdo.dev/acme/users')
    const result = resolveApiNamespace(request, '/:org')
    expect(result.ns).toBe('https://api.dotdo.dev/acme')
    expect(result.remainingPath).toBe('/users')
  })

  it('extracts nested path params for pattern', () => {
    const request = new Request('https://api.dotdo.dev/acme/proj1/tasks')
    const result = resolveApiNamespace(request, '/:org/:project')
    expect(result.ns).toBe('https://api.dotdo.dev/acme/proj1')
    expect(result.remainingPath).toBe('/tasks')
  })
})

// =============================================================================
// findDOBinding Tests
// =============================================================================

describe('findDOBinding', () => {
  it('finds DO binding in env', () => {
    const mockDO = {
      idFromName: vi.fn(),
      get: vi.fn(),
    }
    const env = { DO: mockDO, OTHER: 'value' }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBe(mockDO)
  })

  it('returns null when no DO binding found', () => {
    const env = { OTHER: 'value', ANOTHER: 123 }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })

  it('ignores non-DO objects', () => {
    const notDO = { someMethod: vi.fn() }
    const env = { NOT_DO: notDO }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBeNull()
  })

  it('finds DO binding when multiple bindings exist', () => {
    const mockDO = {
      idFromName: vi.fn(),
      get: vi.fn(),
    }
    const env = {
      KV: { get: vi.fn() },
      DO: mockDO,
      R2: { put: vi.fn() },
    }
    const result = findDOBinding(env as unknown as Record<string, unknown>)
    expect(result).toBe(mockDO)
  })
})

// =============================================================================
// getDOStub Tests
// =============================================================================

describe('getDOStub', () => {
  it('returns stub from namespace', () => {
    const mockStub = { fetch: vi.fn() }
    const mockId = { toString: () => 'test-id' }
    const mockNamespace = {
      idFromName: vi.fn().mockReturnValue(mockId),
      get: vi.fn().mockReturnValue(mockStub),
    }

    const result = getDOStub(mockNamespace as unknown as DurableObjectNamespace, 'test')
    expect(mockNamespace.idFromName).toHaveBeenCalledWith('test')
    expect(mockNamespace.get).toHaveBeenCalledWith(mockId)
    expect(result).toBe(mockStub)
  })
})

// =============================================================================
// getForwardPath Tests
// =============================================================================

describe('getForwardPath', () => {
  it('returns path unchanged for hostname mode', () => {
    const config: ProxyConfig = {
      mode: 'hostname',
      hostname: { rootDomain: 'api.dotdo.dev' },
    }
    const request = new Request('https://tenant.api.dotdo.dev/users/123')
    const result = getForwardPath(request, config)
    expect(result).toBe('/users/123')
  })

  it('strips namespace from path mode', () => {
    const config: ProxyConfig = { mode: 'path' }
    const request = new Request('https://api.dotdo.dev/tenant/users')
    const result = getForwardPath(request, config)
    expect(result).toBe('/users')
  })

  it('strips basepath before forwarding', () => {
    const config: ProxyConfig = {
      mode: 'hostname',
      hostname: { rootDomain: 'api.dotdo.dev' },
      basepath: '/api/v1',
    }
    const request = new Request('https://tenant.api.dotdo.dev/api/v1/users')
    const result = getForwardPath(request, config)
    expect(result).toBe('/users')
  })

  it('handles root path', () => {
    const config: ProxyConfig = {
      mode: 'hostname',
      hostname: { rootDomain: 'api.dotdo.dev' },
    }
    const request = new Request('https://tenant.api.dotdo.dev/')
    const result = getForwardPath(request, config)
    expect(result).toBe('/')
  })

  it('handles path with no remaining segments in path mode', () => {
    const config: ProxyConfig = { mode: 'path' }
    const request = new Request('https://api.dotdo.dev/tenant')
    const result = getForwardPath(request, config)
    expect(result).toBe('/')
  })
})

// =============================================================================
// createForwardRequest Tests
// =============================================================================

describe('createForwardRequest', () => {
  it('creates request with correct URL', () => {
    const original = new Request('https://api.dotdo.dev/original?q=test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    })

    const result = createForwardRequest(original, '/users')
    const url = new URL(result.url)

    expect(url.pathname).toBe('/users')
    expect(url.search).toBe('?q=test')
  })

  it('preserves HTTP method', () => {
    const original = new Request('https://api.dotdo.dev/', { method: 'DELETE' })
    const result = createForwardRequest(original, '/users/123')
    expect(result.method).toBe('DELETE')
  })

  it('preserves headers', () => {
    const original = new Request('https://api.dotdo.dev/', {
      headers: {
        'Authorization': 'Bearer token',
        'X-Custom': 'value',
      },
    })
    const result = createForwardRequest(original, '/path')
    expect(result.headers.get('Authorization')).toBe('Bearer token')
    expect(result.headers.get('X-Custom')).toBe('value')
  })
})

// =============================================================================
// Error Response Tests
// =============================================================================

describe('errorResponse', () => {
  it('creates JSON error response with correct status', async () => {
    const response = errorResponse(400, 'Bad Request')
    expect(response.status).toBe(400)
    expect(response.headers.get('Content-Type')).toBe('application/json')

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Bad Request')
  })

  it('creates 500 error response', async () => {
    const response = errorResponse(500, 'Internal Server Error')
    expect(response.status).toBe(500)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Internal Server Error')
  })
})

describe('notFoundResponse', () => {
  it('creates 404 response with default message', async () => {
    const response = notFoundResponse()
    expect(response.status).toBe(404)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Not Found')
  })

  it('creates 404 response with custom message', async () => {
    const response = notFoundResponse('Resource not found')
    expect(response.status).toBe(404)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Resource not found')
  })
})

describe('serviceUnavailableResponse', () => {
  it('creates 503 response with default message', async () => {
    const response = serviceUnavailableResponse()
    expect(response.status).toBe(503)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Service Unavailable')
  })

  it('creates 503 response with error message', async () => {
    const error = new Error('Connection timeout')
    const response = serviceUnavailableResponse(error)
    expect(response.status).toBe(503)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('Connection timeout')
  })
})
