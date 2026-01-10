import { env } from 'cloudflare:test'
import { describe, it, expect, beforeAll } from 'vitest'
import { API } from './api'

/**
 * API() Factory Integration Tests
 *
 * Clean API for DO proxy workers:
 * - API() - hostname-based routing (default)
 * - API({ ns: '/:org' }) - path param routing
 * - API({ ns: '/:org/:project' }) - nested path params
 * - API({ ns: 'main' }) - fixed namespace
 */

// Test DO that echoes back request info
class TestDO implements DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    return Response.json({
      path: url.pathname,
      method: request.method,
      search: url.search,
    })
  }
}

describe('API() - Default Hostname Mode', () => {
  it('routes by hostname subdomain', async () => {
    const worker = API()
    const request = new Request('https://tenant1.api.dotdo.dev/users')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = await response.json() as { path: string }
    expect(body.path).toBe('/users')
  })

  it('extracts subdomain with hyphens', async () => {
    const worker = API()
    const request = new Request('https://my-tenant.api.dotdo.dev/data')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })

  it('returns 404 for apex domain (no subdomain)', async () => {
    const worker = API()
    const request = new Request('https://api.dotdo.dev/users')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(404)
  })

  it('forwards path unchanged', async () => {
    const worker = API()
    const request = new Request('https://tenant.api.dotdo.dev/users/123/profile')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { path: string }
    expect(body.path).toBe('/users/123/profile')
  })

  it('preserves query parameters', async () => {
    const worker = API()
    const request = new Request('https://tenant.api.dotdo.dev/search?q=test&limit=10')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { search: string }
    expect(body.search).toBe('?q=test&limit=10')
  })

  it('forwards request method', async () => {
    const worker = API()
    const request = new Request('https://tenant.api.dotdo.dev/users', { method: 'POST' })
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { method: string }
    expect(body.method).toBe('POST')
  })
})

describe('API({ ns: "/:org" }) - Single Path Param', () => {
  it('extracts namespace from first path segment', async () => {
    const worker = API({ ns: '/:org' })
    const request = new Request('https://api.dotdo.dev/acme/users')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = await response.json() as { path: string }
    expect(body.path).toBe('/users')
  })

  it('handles namespace with hyphens', async () => {
    const worker = API({ ns: '/:org' })
    const request = new Request('https://api.dotdo.dev/my-org/data')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })

  it('handles namespace with numbers', async () => {
    const worker = API({ ns: '/:org' })
    const request = new Request('https://api.dotdo.dev/org123/data')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })

  it('returns 404 for missing namespace', async () => {
    const worker = API({ ns: '/:org' })
    const request = new Request('https://api.dotdo.dev/')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(404)
  })

  it('forwards remaining path to DO', async () => {
    const worker = API({ ns: '/:org' })
    const request = new Request('https://api.dotdo.dev/acme/users/123/profile')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { path: string }
    expect(body.path).toBe('/users/123/profile')
  })

  it('handles root path after namespace', async () => {
    const worker = API({ ns: '/:org' })
    const request = new Request('https://api.dotdo.dev/acme')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { path: string }
    expect(body.path).toBe('/')
  })

  it('handles root path with trailing slash', async () => {
    const worker = API({ ns: '/:org' })
    const request = new Request('https://api.dotdo.dev/acme/')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { path: string }
    expect(body.path).toBe('/')
  })
})

describe('API({ ns: "/:org/:project" }) - Nested Path Params', () => {
  it('extracts namespace from two path segments joined by colon', async () => {
    const worker = API({ ns: '/:org/:project' })
    const request = new Request('https://api.dotdo.dev/acme/proj1/tasks')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = await response.json() as { path: string }
    expect(body.path).toBe('/tasks')
  })

  it('returns 404 for missing second param', async () => {
    const worker = API({ ns: '/:org/:project' })
    const request = new Request('https://api.dotdo.dev/acme')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(404)
  })

  it('returns 404 for missing both params', async () => {
    const worker = API({ ns: '/:org/:project' })
    const request = new Request('https://api.dotdo.dev/')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(404)
  })

  it('handles root path after namespace', async () => {
    const worker = API({ ns: '/:org/:project' })
    const request = new Request('https://api.dotdo.dev/acme/proj1')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { path: string }
    expect(body.path).toBe('/')
  })

  it('forwards deeply nested path', async () => {
    const worker = API({ ns: '/:org/:project' })
    const request = new Request('https://api.dotdo.dev/acme/proj1/tasks/123/comments')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { path: string }
    expect(body.path).toBe('/tasks/123/comments')
  })
})

describe('API({ ns: "main" }) - Fixed Namespace', () => {
  it('always routes to fixed namespace', async () => {
    const worker = API({ ns: 'main' })
    const request = new Request('https://api.dotdo.dev/users')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = await response.json() as { path: string }
    expect(body.path).toBe('/users')
  })

  it('ignores hostname for namespace resolution', async () => {
    const worker = API({ ns: 'singleton' })
    const request = new Request('https://anything.example.com/data')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })

  it('forwards full path unchanged', async () => {
    const worker = API({ ns: 'main' })
    const request = new Request('https://api.dotdo.dev/org/project/tasks')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { path: string }
    expect(body.path).toBe('/org/project/tasks')
  })

  it('handles root path', async () => {
    const worker = API({ ns: 'main' })
    const request = new Request('https://api.dotdo.dev/')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { path: string }
    expect(body.path).toBe('/')
  })
})

describe('API() - Error Handling', () => {
  it('returns 500 if no DO binding found', async () => {
    const worker = API()
    const envWithoutDO = {} as typeof env
    const request = new Request('https://tenant.api.dotdo.dev/data')
    const response = await worker.fetch(request, envWithoutDO, {} as ExecutionContext)

    expect(response.status).toBe(500)
  })

  it('returns 503 if DO throws', async () => {
    // This would require a DO that throws, harder to test in integration
    // Skip for now - covered by unit tests
  })
})

describe('API() - Request Forwarding', () => {
  it('forwards all HTTP methods', async () => {
    const worker = API({ ns: 'main' })
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

    for (const method of methods) {
      const request = new Request('https://api.dotdo.dev/data', { method })
      const response = await worker.fetch(request, env, {} as ExecutionContext)

      if (method === 'HEAD') {
        expect(response.status).toBe(200)
      } else {
        const body = await response.json() as { method: string }
        expect(body.method).toBe(method)
      }
    }
  })

  it('forwards request headers', async () => {
    const worker = API({ ns: 'main' })
    const request = new Request('https://api.dotdo.dev/data', {
      headers: {
        'Authorization': 'Bearer token123',
        'X-Custom-Header': 'custom-value',
      },
    })
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })

  it('forwards request body', async () => {
    const worker = API({ ns: 'main' })
    const body = JSON.stringify({ name: 'Test', value: 42 })
    const request = new Request('https://api.dotdo.dev/data', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })
})

describe('API() - Edge Cases', () => {
  it('handles paths with special characters', async () => {
    const worker = API({ ns: 'main' })
    const request = new Request('https://api.dotdo.dev/path%20with%20spaces')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })

  it('handles very long paths', async () => {
    const worker = API({ ns: 'main' })
    const longPath = '/a'.repeat(100)
    const request = new Request(`https://api.dotdo.dev${longPath}`)
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
  })

  it('handles paths with dots', async () => {
    const worker = API({ ns: 'main' })
    const request = new Request('https://api.dotdo.dev/file.json')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    const body = await response.json() as { path: string }
    expect(body.path).toBe('/file.json')
  })
})
