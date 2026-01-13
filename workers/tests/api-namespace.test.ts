import { describe, it, expect, vi, beforeEach } from 'vitest'
import { API } from '../api'

/**
 * API() Factory Namespace Extraction Tests
 *
 * These tests verify that the API() factory extracts the correct namespace
 * and calls DO.idFromName with the full namespace URL.
 *
 * Key behaviors being tested:
 * 1. Hostname-only mode: tenant.api.example.org.ai -> ns='https://tenant.api.example.org.ai'
 * 2. Path param mode: api.example.org.ai/acme -> ns='https://api.example.org.ai/acme'
 * 3. Nested params: api.example.org.ai/acme/proj -> ns='https://api.example.org.ai/acme/proj'
 * 4. Fixed namespace mode: any request -> ns='main' (literal)
 *
 * All tests are expected to FAIL (red phase) since the current implementation
 * extracts simple strings like 'tenant' instead of full URLs.
 */

// Mock DO stub that tracks calls
function createMockEnv() {
  const idFromNameCalls: string[] = []
  const getCalls: DurableObjectId[] = []

  const mockStub = {
    fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })),
  }

  const mockId: DurableObjectId = {
    toString: () => 'mock-id',
    equals: () => false,
    name: 'mock-name',
  }

  const mockDO: DurableObjectNamespace = {
    idFromName: vi.fn((name: string) => {
      idFromNameCalls.push(name)
      return mockId
    }),
    idFromString: vi.fn(() => mockId),
    newUniqueId: vi.fn(() => mockId),
    get: vi.fn((id: DurableObjectId) => {
      getCalls.push(id)
      return mockStub as unknown as DurableObjectStub
    }),
    jurisdiction: vi.fn(() => ({} as DurableObjectNamespace)),
  }

  return {
    DO: mockDO,
    idFromNameCalls,
    getCalls,
    mockStub,
  }
}

describe('API() Namespace Extraction - Hostname Mode (Default)', () => {
  it('should call idFromName with full URL namespace for hostname-based routing', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API()

    // Request to https://tenant.api.example.org.ai/customers
    const request = new Request('https://tenant.api.example.org.ai/customers')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    // Should extract full URL namespace: 'https://tenant.api.example.org.ai'
    expect(idFromNameCalls).toHaveLength(1)
    expect(idFromNameCalls[0]).toBe('https://tenant.api.example.org.ai')
  })

  it('should preserve protocol in namespace URL', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API()

    // HTTP (not HTTPS) request
    const request = new Request('http://tenant.api.example.org.ai/customers')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    expect(idFromNameCalls[0]).toBe('http://tenant.api.example.org.ai')
  })

  it('should exclude path from namespace URL', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API()

    const request = new Request('https://tenant.api.example.org.ai/customers/123/orders')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    // Namespace should NOT include the path
    expect(idFromNameCalls[0]).toBe('https://tenant.api.example.org.ai')
    expect(idFromNameCalls[0]).not.toContain('/customers')
  })

  it('should exclude query string from namespace URL', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API()

    const request = new Request('https://tenant.api.example.org.ai/search?q=test')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    expect(idFromNameCalls[0]).toBe('https://tenant.api.example.org.ai')
    expect(idFromNameCalls[0]).not.toContain('?')
  })

  it('should preserve port in namespace URL', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API()

    const request = new Request('https://tenant.api.example.org.ai:8443/data')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    expect(idFromNameCalls[0]).toBe('https://tenant.api.example.org.ai:8443')
  })

  it('should forward remaining path to DO', async () => {
    const { DO, mockStub } = createMockEnv()
    const worker = API()

    const request = new Request('https://tenant.api.example.org.ai/customers')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    // Check the forwarded request path
    const fetchCall = mockStub.fetch.mock.calls[0][0] as Request
    const forwardedUrl = new URL(fetchCall.url)
    expect(forwardedUrl.pathname).toBe('/customers')
  })
})

describe('API() Namespace Extraction - Path Param Mode', () => {
  it('should call idFromName with full URL including path segment', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API({ ns: '/:org' })

    // Request to https://api.example.org.ai/acme/customers
    const request = new Request('https://api.example.org.ai/acme/customers')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    // Should extract: 'https://api.example.org.ai/acme'
    expect(idFromNameCalls).toHaveLength(1)
    expect(idFromNameCalls[0]).toBe('https://api.example.org.ai/acme')
  })

  it('should handle path param with hyphens', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API({ ns: '/:org' })

    const request = new Request('https://api.example.org.ai/my-organization/data')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    expect(idFromNameCalls[0]).toBe('https://api.example.org.ai/my-organization')
  })

  it('should forward remaining path after namespace segment', async () => {
    const { DO, mockStub } = createMockEnv()
    const worker = API({ ns: '/:org' })

    const request = new Request('https://api.example.org.ai/acme/customers/123/orders')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    const fetchCall = mockStub.fetch.mock.calls[0][0] as Request
    const forwardedUrl = new URL(fetchCall.url)
    expect(forwardedUrl.pathname).toBe('/customers/123/orders')
  })

  it('should forward root path when only namespace provided', async () => {
    const { DO, mockStub } = createMockEnv()
    const worker = API({ ns: '/:org' })

    const request = new Request('https://api.example.org.ai/acme')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    const fetchCall = mockStub.fetch.mock.calls[0][0] as Request
    const forwardedUrl = new URL(fetchCall.url)
    expect(forwardedUrl.pathname).toBe('/')
  })
})

describe('API() Namespace Extraction - Nested Path Params', () => {
  it('should call idFromName with full URL including both path segments', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API({ ns: '/:org/:project' })

    // Request to https://api.example.org.ai/acme/proj1/tasks
    const request = new Request('https://api.example.org.ai/acme/proj1/tasks')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    // Should extract: 'https://api.example.org.ai/acme/proj1'
    expect(idFromNameCalls).toHaveLength(1)
    expect(idFromNameCalls[0]).toBe('https://api.example.org.ai/acme/proj1')
  })

  it('should handle multiple path segments with special characters', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API({ ns: '/:org/:project' })

    const request = new Request('https://api.example.org.ai/my-org/project-123/data')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    expect(idFromNameCalls[0]).toBe('https://api.example.org.ai/my-org/project-123')
  })

  it('should forward remaining path after both namespace segments', async () => {
    const { DO, mockStub } = createMockEnv()
    const worker = API({ ns: '/:org/:project' })

    const request = new Request('https://api.example.org.ai/acme/proj1/tasks/456/comments')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    const fetchCall = mockStub.fetch.mock.calls[0][0] as Request
    const forwardedUrl = new URL(fetchCall.url)
    expect(forwardedUrl.pathname).toBe('/tasks/456/comments')
  })

  it('should forward root path when only namespace segments provided', async () => {
    const { DO, mockStub } = createMockEnv()
    const worker = API({ ns: '/:org/:project' })

    const request = new Request('https://api.example.org.ai/acme/proj1')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    const fetchCall = mockStub.fetch.mock.calls[0][0] as Request
    const forwardedUrl = new URL(fetchCall.url)
    expect(forwardedUrl.pathname).toBe('/')
  })
})

describe('API() Namespace Extraction - Fixed Namespace Mode', () => {
  it('should call idFromName with literal fixed namespace', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API({ ns: 'main' })

    const request = new Request('https://api.example.org.ai/users')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    // Fixed namespace - should use literal value 'main'
    expect(idFromNameCalls).toHaveLength(1)
    expect(idFromNameCalls[0]).toBe('main')
  })

  it('should ignore hostname when fixed namespace is set', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API({ ns: 'singleton' })

    // Different hostname - should still use 'singleton'
    const request = new Request('https://tenant.custom.domain.com/data')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    expect(idFromNameCalls[0]).toBe('singleton')
  })

  it('should forward full path unchanged with fixed namespace', async () => {
    const { DO, mockStub } = createMockEnv()
    const worker = API({ ns: 'main' })

    const request = new Request('https://api.example.org.ai/org/project/tasks')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    const fetchCall = mockStub.fetch.mock.calls[0][0] as Request
    const forwardedUrl = new URL(fetchCall.url)
    expect(forwardedUrl.pathname).toBe('/org/project/tasks')
  })

  it('should work with various fixed namespace values', async () => {
    const testCases = ['main', 'singleton', 'default', 'global', 'shared']

    for (const ns of testCases) {
      const { DO, idFromNameCalls } = createMockEnv()
      const worker = API({ ns })

      const request = new Request('https://api.example.org.ai/data')
      await worker.fetch!(request, { DO }, {} as ExecutionContext)

      expect(idFromNameCalls[0]).toBe(ns)
    }
  })
})

describe('API() Namespace Extraction - Edge Cases', () => {
  it('should return 404 when namespace cannot be extracted (hostname mode, apex domain)', async () => {
    const { DO } = createMockEnv()
    const worker = API()

    // Apex domain with only 3 parts - no subdomain to extract
    const request = new Request('https://api.example.com/users')
    const response = await worker.fetch!(request, { DO }, {} as ExecutionContext)

    expect(response.status).toBe(404)
  })

  it('should return 404 when namespace cannot be extracted (path mode, missing segment)', async () => {
    const { DO } = createMockEnv()
    const worker = API({ ns: '/:org' })

    // No path segment to extract
    const request = new Request('https://api.example.org.ai/')
    const response = await worker.fetch!(request, { DO }, {} as ExecutionContext)

    expect(response.status).toBe(404)
  })

  it('should return 404 when nested params missing second segment', async () => {
    const { DO } = createMockEnv()
    const worker = API({ ns: '/:org/:project' })

    // Only one path segment when two are required
    const request = new Request('https://api.example.org.ai/acme')
    const response = await worker.fetch!(request, { DO }, {} as ExecutionContext)

    expect(response.status).toBe(404)
  })

  it('should return 500 when no DO binding is found', async () => {
    const worker = API()

    const request = new Request('https://tenant.api.example.org.ai/data')
    const response = await worker.fetch!(request, {}, {} as ExecutionContext)

    expect(response.status).toBe(500)
  })
})

describe('API() Namespace URL Format Verification', () => {
  it('should use URL format for namespace to ensure global uniqueness', async () => {
    const { DO, idFromNameCalls } = createMockEnv()
    const worker = API()

    // The same tenant name on different domains should produce different namespaces
    const request = new Request('https://tenant.api.example.org.ai/data')
    await worker.fetch!(request, { DO }, {} as ExecutionContext)

    // Must be full URL - not just 'tenant'
    expect(idFromNameCalls[0]).toMatch(/^https?:\/\//)
    expect(idFromNameCalls[0]).toContain('tenant.api.example.org.ai')
  })

  it('should differentiate same tenant across different domains', async () => {
    // First domain
    const env1 = createMockEnv()
    const worker1 = API()
    await worker1.fetch!(
      new Request('https://acme.api.platform1.org.ai/data'),
      { DO: env1.DO },
      {} as ExecutionContext
    )

    // Second domain (same tenant name 'acme')
    const env2 = createMockEnv()
    const worker2 = API()
    await worker2.fetch!(
      new Request('https://acme.api.platform2.org.ai/data'),
      { DO: env2.DO },
      {} as ExecutionContext
    )

    // Namespaces should be different because domains differ
    expect(env1.idFromNameCalls[0]).not.toBe(env2.idFromNameCalls[0])
    expect(env1.idFromNameCalls[0]).toBe('https://acme.api.platform1.org.ai')
    expect(env2.idFromNameCalls[0]).toBe('https://acme.api.platform2.org.ai')
  })
})
