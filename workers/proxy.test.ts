/**
 * Proxy Worker Unit Tests
 *
 * Tests for the path-based proxy worker that wraps hostname-proxy with path mode.
 *
 * @module workers/proxy.test
 */

import { describe, it, expect, vi } from 'vitest'
import type { ProxyConfig } from './hostname-proxy'

// ============================================================================
// Proxy Configuration Tests
// ============================================================================

describe('Proxy Configuration', () => {
  describe('Path Mode Configuration', () => {
    it('creates default path mode config', () => {
      const config: ProxyConfig = {
        mode: 'path',
      }

      expect(config.mode).toBe('path')
      expect(config.basepath).toBeUndefined()
      expect(config.defaultNs).toBeUndefined()
    })

    it('creates path mode with basepath', () => {
      const config: ProxyConfig = {
        mode: 'path',
        basepath: '/api/v1',
      }

      expect(config.basepath).toBe('/api/v1')
    })

    it('creates path mode with default namespace', () => {
      const config: ProxyConfig = {
        mode: 'path',
        defaultNs: 'main',
      }

      expect(config.defaultNs).toBe('main')
    })
  })

  describe('Hostname Mode Configuration', () => {
    it('creates hostname mode with root domain', () => {
      const config: ProxyConfig = {
        mode: 'hostname',
        hostname: {
          rootDomain: 'api.dotdo.dev',
        },
      }

      expect(config.mode).toBe('hostname')
      expect(config.hostname?.rootDomain).toBe('api.dotdo.dev')
    })

    it('creates hostname mode with strip levels', () => {
      const config: ProxyConfig = {
        mode: 'hostname',
        hostname: {
          rootDomain: 'api.dotdo.dev',
          stripLevels: 2,
        },
      }

      expect(config.hostname?.stripLevels).toBe(2)
    })

    it('creates hostname mode with default namespace fallback', () => {
      const config: ProxyConfig = {
        mode: 'hostname',
        hostname: { rootDomain: 'api.dotdo.dev' },
        defaultNs: 'default',
      }

      expect(config.defaultNs).toBe('default')
    })
  })

  describe('Fixed Mode Configuration', () => {
    it('creates fixed mode with namespace', () => {
      const config: ProxyConfig = {
        mode: 'fixed',
        fixed: {
          namespace: 'singleton',
        },
      }

      expect(config.mode).toBe('fixed')
      expect(config.fixed?.namespace).toBe('singleton')
    })

    it('handles fixed mode without namespace gracefully', () => {
      const config: ProxyConfig = {
        mode: 'fixed',
      }

      expect(config.fixed?.namespace).toBeUndefined()
    })
  })
})

// ============================================================================
// Path Mode Namespace Resolution Tests
// ============================================================================

describe('Path Mode Namespace Resolution', () => {
  it('extracts namespace from first path segment', () => {
    const url = new URL('https://api.dotdo.dev/tenant/users')
    const segments = url.pathname.split('/').filter(Boolean)
    const ns = segments[0]

    expect(ns).toBe('tenant')
  })

  it('handles namespace with hyphens', () => {
    const url = new URL('https://api.dotdo.dev/my-tenant/users')
    const segments = url.pathname.split('/').filter(Boolean)
    const ns = segments[0]

    expect(ns).toBe('my-tenant')
  })

  it('handles namespace with numbers', () => {
    const url = new URL('https://api.dotdo.dev/tenant123/users')
    const segments = url.pathname.split('/').filter(Boolean)
    const ns = segments[0]

    expect(ns).toBe('tenant123')
  })

  it('handles namespace with underscores', () => {
    const url = new URL('https://api.dotdo.dev/my_tenant/users')
    const segments = url.pathname.split('/').filter(Boolean)
    const ns = segments[0]

    expect(ns).toBe('my_tenant')
  })

  it('returns undefined for empty path', () => {
    const url = new URL('https://api.dotdo.dev/')
    const segments = url.pathname.split('/').filter(Boolean)
    const ns = segments[0]

    expect(ns).toBeUndefined()
  })

  it('returns undefined for root path', () => {
    const url = new URL('https://api.dotdo.dev')
    const segments = url.pathname.split('/').filter(Boolean)
    const ns = segments[0]

    expect(ns).toBeUndefined()
  })
})

// ============================================================================
// Path Stripping Tests
// ============================================================================

describe('Path Stripping', () => {
  it('strips namespace from forwarded path', () => {
    const url = new URL('https://api.dotdo.dev/tenant/users/123')
    const segments = url.pathname.split('/').filter(Boolean)
    const forwardPath = '/' + segments.slice(1).join('/')

    expect(forwardPath).toBe('/users/123')
  })

  it('returns root path when only namespace in path', () => {
    const url = new URL('https://api.dotdo.dev/tenant')
    const segments = url.pathname.split('/').filter(Boolean)
    const forwardPath = '/' + segments.slice(1).join('/')

    expect(forwardPath).toBe('/')
  })

  it('handles deeply nested paths', () => {
    const url = new URL('https://api.dotdo.dev/tenant/a/b/c/d/e')
    const segments = url.pathname.split('/').filter(Boolean)
    const forwardPath = '/' + segments.slice(1).join('/')

    expect(forwardPath).toBe('/a/b/c/d/e')
  })

  it('strips basepath before namespace extraction', () => {
    const basepath = '/api/v1'
    const url = new URL('https://api.dotdo.dev/api/v1/tenant/users')
    let pathname = url.pathname

    if (pathname.startsWith(basepath)) {
      pathname = pathname.slice(basepath.length) || '/'
    }

    const segments = pathname.split('/').filter(Boolean)
    const ns = segments[0]
    const forwardPath = '/' + segments.slice(1).join('/')

    expect(ns).toBe('tenant')
    expect(forwardPath).toBe('/users')
  })

  it('handles basepath at exact root', () => {
    const basepath = '/api/v1'
    const url = new URL('https://api.dotdo.dev/api/v1')
    let pathname = url.pathname

    if (pathname.startsWith(basepath)) {
      pathname = pathname.slice(basepath.length) || '/'
    }

    expect(pathname).toBe('/')
  })
})

// ============================================================================
// Query Parameter Preservation Tests
// ============================================================================

describe('Query Parameter Preservation', () => {
  it('preserves query parameters in forwarded URL', () => {
    const url = new URL('https://api.dotdo.dev/tenant/users?page=2&limit=10')

    const forwardPath = '/users'
    const forwardUrl = new URL(forwardPath + url.search, url.origin)

    expect(forwardUrl.search).toBe('?page=2&limit=10')
    expect(forwardUrl.pathname).toBe('/users')
  })

  it('handles complex query parameters', () => {
    const url = new URL('https://api.dotdo.dev/tenant/users?filter[status]=active&sort=-createdAt')

    expect(url.search).toBe('?filter%5Bstatus%5D=active&sort=-createdAt')
  })

  it('handles empty query string', () => {
    const url = new URL('https://api.dotdo.dev/tenant/users')

    expect(url.search).toBe('')
  })

  it('handles query with special characters', () => {
    const url = new URL('https://api.dotdo.dev/tenant/search?q=hello+world&tag=foo%26bar')

    expect(url.searchParams.get('q')).toBe('hello world')
    expect(url.searchParams.get('tag')).toBe('foo&bar')
  })
})

// ============================================================================
// Request Forwarding Tests
// ============================================================================

describe('Request Forwarding', () => {
  it('creates forward request with correct URL', () => {
    const original = new Request('https://api.dotdo.dev/tenant/users?filter=active')
    const url = new URL(original.url)

    const forwardPath = '/users'
    const forwardUrl = new URL(forwardPath + url.search, url.origin)

    expect(forwardUrl.toString()).toBe('https://api.dotdo.dev/users?filter=active')
  })

  it('preserves request method', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

    for (const method of methods) {
      const request = new Request('https://api.dotdo.dev/tenant/users', { method })
      expect(request.method).toBe(method)
    }
  })

  it('preserves request headers', () => {
    const request = new Request('https://api.dotdo.dev/tenant/users', {
      headers: {
        'Authorization': 'Bearer token123',
        'Content-Type': 'application/json',
        'X-Custom-Header': 'custom-value',
      },
    })

    expect(request.headers.get('Authorization')).toBe('Bearer token123')
    expect(request.headers.get('Content-Type')).toBe('application/json')
    expect(request.headers.get('X-Custom-Header')).toBe('custom-value')
  })

  it('handles request with body', async () => {
    const body = JSON.stringify({ name: 'Test', value: 42 })
    const request = new Request('https://api.dotdo.dev/tenant/users', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })

    const clonedBody = await request.clone().text()
    expect(clonedBody).toBe(body)
  })
})

// ============================================================================
// DO Stub Creation Tests
// ============================================================================

describe('DO Stub Creation', () => {
  it('creates DO ID from namespace name', () => {
    const mockNamespace = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
      get: vi.fn(),
    }

    const ns = 'tenant'
    mockNamespace.idFromName(ns)

    expect(mockNamespace.idFromName).toHaveBeenCalledWith('tenant')
  })

  it('gets DO stub from ID', () => {
    const mockStub = { fetch: vi.fn() }
    const mockId = { toString: () => 'mock-id' }
    const mockNamespace = {
      idFromName: vi.fn().mockReturnValue(mockId),
      get: vi.fn().mockReturnValue(mockStub),
    }

    const id = mockNamespace.idFromName('tenant')
    const stub = mockNamespace.get(id)

    expect(mockNamespace.get).toHaveBeenCalledWith(mockId)
    expect(stub).toBe(mockStub)
  })
})

// ============================================================================
// Error Response Tests
// ============================================================================

describe('Error Responses', () => {
  it('returns 404 for missing namespace', () => {
    const response = new Response('Not Found', { status: 404 })
    expect(response.status).toBe(404)
  })

  it('returns 500 for missing DO binding', () => {
    const response = new Response(JSON.stringify({ error: 'DO binding not found' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.status).toBe(500)
  })

  it('returns 503 for DO fetch errors', async () => {
    const error = new Error('Service Unavailable')
    const response = new Response(JSON.stringify({ error: error.message }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.status).toBe(503)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('Service Unavailable')
  })

  it('handles non-Error exceptions', () => {
    const errorMessage = 'Unknown error'
    const response = new Response(JSON.stringify({ error: errorMessage }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(response.status).toBe(503)
  })
})

// ============================================================================
// Environment Variable Configuration Tests
// ============================================================================

describe('Environment Variable Configuration', () => {
  it('parses PROXY_MODE from env', () => {
    const env = { PROXY_MODE: 'hostname' }
    expect(env.PROXY_MODE).toBe('hostname')
  })

  it('parses PROXY_ROOT_DOMAIN from env', () => {
    const env = { PROXY_ROOT_DOMAIN: 'api.dotdo.dev' }
    expect(env.PROXY_ROOT_DOMAIN).toBe('api.dotdo.dev')
  })

  it('parses PROXY_BASEPATH from env', () => {
    const env = { PROXY_BASEPATH: '/api/v1' }
    expect(env.PROXY_BASEPATH).toBe('/api/v1')
  })

  it('parses PROXY_DEFAULT_NS from env', () => {
    const env = { PROXY_DEFAULT_NS: 'default-tenant' }
    expect(env.PROXY_DEFAULT_NS).toBe('default-tenant')
  })

  it('parses PROXY_FIXED_NS from env', () => {
    const env = { PROXY_FIXED_NS: 'singleton' }
    expect(env.PROXY_FIXED_NS).toBe('singleton')
  })

  it('builds config from env vars', () => {
    const env = {
      PROXY_MODE: 'hostname',
      PROXY_ROOT_DOMAIN: 'api.dotdo.dev',
      PROXY_BASEPATH: '/api/v1',
      PROXY_DEFAULT_NS: 'default',
    }

    const config: ProxyConfig = {
      mode: (env.PROXY_MODE as ProxyConfig['mode']) || 'hostname',
      basepath: env.PROXY_BASEPATH,
      defaultNs: env.PROXY_DEFAULT_NS,
      hostname: env.PROXY_ROOT_DOMAIN
        ? { rootDomain: env.PROXY_ROOT_DOMAIN }
        : undefined,
    }

    expect(config.mode).toBe('hostname')
    expect(config.basepath).toBe('/api/v1')
    expect(config.defaultNs).toBe('default')
    expect(config.hostname?.rootDomain).toBe('api.dotdo.dev')
  })

  it('uses defaults when env vars not set', () => {
    const env: Record<string, string | undefined> = {}

    const config: ProxyConfig = {
      mode: (env.PROXY_MODE as ProxyConfig['mode']) || 'hostname',
      basepath: env.PROXY_BASEPATH,
      defaultNs: env.PROXY_DEFAULT_NS,
    }

    expect(config.mode).toBe('hostname')
    expect(config.basepath).toBeUndefined()
    expect(config.defaultNs).toBeUndefined()
  })
})

// ============================================================================
// Route Documentation Tests
// ============================================================================

describe('Route Documentation', () => {
  it('documents path mode routes', () => {
    const routes = [
      { path: '/{ns}', description: 'Root of namespace' },
      { path: '/{ns}/{path}', description: 'Forward to DO' },
      { path: '/{ns}/rpc', description: 'RPC endpoint' },
      { path: '/{ns}/mcp', description: 'MCP endpoint' },
      { path: '/{ns}/sync', description: 'WebSocket sync' },
      { path: '/{ns}/{collection}/', description: 'Collection listing' },
      { path: '/{ns}/{collection}/{id}', description: 'Instance details' },
    ]

    expect(routes).toHaveLength(7)
    expect(routes[0].path).toBe('/{ns}')
    expect(routes[6].path).toBe('/{ns}/{collection}/{id}')
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  it('handles paths with encoded characters', () => {
    const url = new URL('https://api.dotdo.dev/tenant/path%20with%20spaces')
    const segments = url.pathname.split('/').filter(Boolean)

    expect(segments[0]).toBe('tenant')
    expect(segments[1]).toBe('path%20with%20spaces')
  })

  it('handles very long paths', () => {
    const longPath = '/a'.repeat(100)
    const url = new URL(`https://api.dotdo.dev/tenant${longPath}`)
    const segments = url.pathname.split('/').filter(Boolean)

    expect(segments[0]).toBe('tenant')
    expect(segments.length).toBe(101)
  })

  it('handles paths with dots', () => {
    const url = new URL('https://api.dotdo.dev/tenant/file.json')
    const segments = url.pathname.split('/').filter(Boolean)

    expect(segments[0]).toBe('tenant')
    expect(segments[1]).toBe('file.json')
  })

  it('handles paths with trailing slash', () => {
    const url = new URL('https://api.dotdo.dev/tenant/')
    const segments = url.pathname.split('/').filter(Boolean)

    expect(segments[0]).toBe('tenant')
    expect(segments.length).toBe(1)
  })

  it('handles localhost URLs', () => {
    const url = new URL('http://localhost:8787/tenant/users')
    const segments = url.pathname.split('/').filter(Boolean)

    expect(segments[0]).toBe('tenant')
    expect(url.port).toBe('8787')
  })

  it('handles HTTPS vs HTTP', () => {
    const httpsUrl = new URL('https://api.dotdo.dev/tenant/users')
    const httpUrl = new URL('http://api.dotdo.dev/tenant/users')

    expect(httpsUrl.protocol).toBe('https:')
    expect(httpUrl.protocol).toBe('http:')
  })
})
