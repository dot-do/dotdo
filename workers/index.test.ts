/**
 * Minimal DO Proxy Worker Tests
 *
 * Tests for the simplified Hono-based passthrough worker.
 *
 * @module workers/index.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { API, type APIConfig } from './index'

// =============================================================================
// MOCK DO BINDING
// =============================================================================

function createMockDO() {
  const mockStub = {
    fetch: vi.fn().mockResolvedValue(new Response('{"data":"from DO"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
  }

  return {
    idFromName: vi.fn().mockReturnValue({ name: 'test-id' }),
    get: vi.fn().mockReturnValue(mockStub),
    _stub: mockStub
  }
}

// =============================================================================
// API FACTORY TESTS
// =============================================================================

describe('API Factory', () => {
  it('should return a Hono app', () => {
    const app = API()
    expect(app).toBeDefined()
    expect(app.fetch).toBeTypeOf('function')
  })

  it('should return 500 when no DO binding found', async () => {
    const app = API({ ns: 'main' })
    const request = new Request('http://localhost/test')

    const response = await app.fetch(request, {})
    expect(response.status).toBe(500)

    const body = await response.json() as { error: string }
    expect(body.error).toBe('No DO binding found')
  })
})

// =============================================================================
// NAMESPACE RESOLUTION TESTS
// =============================================================================

describe('Namespace Resolution', () => {
  describe('Fixed namespace mode', () => {
    it('should route to fixed namespace', async () => {
      const mockDO = createMockDO()
      const app = API({ ns: 'main' })

      const request = new Request('http://localhost/users')
      const response = await app.fetch(request, { DO: mockDO })

      expect(response.status).toBe(200)
      expect(mockDO.idFromName).toHaveBeenCalledWith('main')
    })
  })

  describe('Path param mode', () => {
    it('should extract namespace from path', async () => {
      const mockDO = createMockDO()
      const app = API({ ns: '/:org' })

      const request = new Request('http://localhost/acme/users')
      const response = await app.fetch(request, { DO: mockDO })

      expect(response.status).toBe(200)
      // Namespace includes origin + path segment
      expect(mockDO.idFromName).toHaveBeenCalledWith('http://localhost/acme')
    })

    it('should extract multiple path segments', async () => {
      const mockDO = createMockDO()
      const app = API({ ns: '/:org/:project' })

      const request = new Request('http://localhost/acme/proj1/tasks')
      const response = await app.fetch(request, { DO: mockDO })

      expect(response.status).toBe(200)
      expect(mockDO.idFromName).toHaveBeenCalledWith('http://localhost/acme/proj1')
    })

    it('should return 404 when not enough path segments', async () => {
      const mockDO = createMockDO()
      const app = API({ ns: '/:org/:project' })

      const request = new Request('http://localhost/acme')
      const response = await app.fetch(request, { DO: mockDO })

      expect(response.status).toBe(404)
    })
  })

  describe('Hostname mode (default)', () => {
    it('should extract namespace from subdomain (4+ parts)', async () => {
      const mockDO = createMockDO()
      const app = API() // No config = hostname mode

      const request = new Request('http://tenant.api.dotdo.dev/users')
      const response = await app.fetch(request, { DO: mockDO })

      expect(response.status).toBe(200)
      expect(mockDO.idFromName).toHaveBeenCalledWith('http://tenant.api.dotdo.dev')
    })

    it('should return 404 for apex domain (3 parts)', async () => {
      const mockDO = createMockDO()
      const app = API()

      const request = new Request('http://api.example.com/users')
      const response = await app.fetch(request, { DO: mockDO })

      expect(response.status).toBe(404)
    })
  })
})

// =============================================================================
// REQUEST FORWARDING TESTS
// =============================================================================

describe('Request Forwarding', () => {
  it('should forward remaining path to DO', async () => {
    const mockDO = createMockDO()
    const app = API({ ns: '/:org' })

    const request = new Request('http://localhost/acme/users/123')
    await app.fetch(request, { DO: mockDO })

    // Check the forwarded request URL
    const forwardedRequest = mockDO._stub.fetch.mock.calls[0][0] as Request
    expect(new URL(forwardedRequest.url).pathname).toBe('/users/123')
  })

  it('should forward query string', async () => {
    const mockDO = createMockDO()
    const app = API({ ns: 'main' })

    const request = new Request('http://localhost/users?page=2&limit=10')
    await app.fetch(request, { DO: mockDO })

    const forwardedRequest = mockDO._stub.fetch.mock.calls[0][0] as Request
    const url = new URL(forwardedRequest.url)
    expect(url.search).toBe('?page=2&limit=10')
  })

  it('should forward request method', async () => {
    const mockDO = createMockDO()
    const app = API({ ns: 'main' })

    const request = new Request('http://localhost/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
      headers: { 'Content-Type': 'application/json' }
    })
    await app.fetch(request, { DO: mockDO })

    const forwardedRequest = mockDO._stub.fetch.mock.calls[0][0] as Request
    expect(forwardedRequest.method).toBe('POST')
  })

  it('should forward headers', async () => {
    const mockDO = createMockDO()
    const app = API({ ns: 'main' })

    const request = new Request('http://localhost/users', {
      headers: {
        'Authorization': 'Bearer token123',
        'X-Custom-Header': 'custom-value'
      }
    })
    await app.fetch(request, { DO: mockDO })

    const forwardedRequest = mockDO._stub.fetch.mock.calls[0][0] as Request
    expect(forwardedRequest.headers.get('Authorization')).toBe('Bearer token123')
    expect(forwardedRequest.headers.get('X-Custom-Header')).toBe('custom-value')
  })

  it('should return DO response', async () => {
    const mockDO = createMockDO()
    const app = API({ ns: 'main' })

    const request = new Request('http://localhost/users')
    const response = await app.fetch(request, { DO: mockDO })

    const body = await response.json() as { data: string }
    expect(body.data).toBe('from DO')
  })
})

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  it('should return 503 when DO throws', async () => {
    const mockDO = {
      idFromName: vi.fn().mockReturnValue({ name: 'test-id' }),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockRejectedValue(new Error('DO unavailable'))
      })
    }

    const app = API({ ns: 'main' })
    const request = new Request('http://localhost/users')
    const response = await app.fetch(request, { DO: mockDO })

    expect(response.status).toBe(503)
    const body = await response.json() as { error: string }
    expect(body.error).toBe('DO unavailable')
  })
})
