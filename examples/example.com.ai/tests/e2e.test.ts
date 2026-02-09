/**
 * E2E Tests for example.com.ai Live Endpoints
 *
 * These tests verify the production do-proxy workers serving:
 * - example.com.ai (parent/apex domain)
 * - crm.example.com.ai (tenant/subdomain)
 *
 * Both respond with HATEOAS-style JSON with links to /.do, /api, /rpc, /mcp, /_health
 *
 * Covers beads issues: do-85bvp.5 and do-85bvp.6
 *
 * @module examples/example.com.ai/tests/e2e
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Constants
// ============================================================================

const PARENT_BASE = 'https://example.com.ai'
const TENANT_BASE = 'https://crm.example.com.ai'

const EXPECTED_LINK_PATHS = ['self', 'identity', 'api', 'rpc', 'mcp', 'health', 'docs'] as const

// ============================================================================
// Helpers
// ============================================================================

async function fetchJSON(url: string): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(url)
  const body = await res.json()
  return { status: res.status, headers: res.headers, body }
}

// ============================================================================
// Parent Domain: example.com.ai
// ============================================================================

describe('example.com.ai (parent domain)', () => {
  describe('GET / — root endpoint', () => {
    it('should return 200 with valid JSON', async () => {
      const { status, body } = await fetchJSON(PARENT_BASE)
      expect(status).toBe(200)
      expect(body).toBeDefined()
      expect(typeof body).toBe('object')
    })

    it('should have the correct api field', async () => {
      const { body } = await fetchJSON(PARENT_BASE) as { body: Record<string, unknown> }
      expect(body.api).toBe('example.com.ai')
    })

    it('should have data with service and description', async () => {
      const { body } = await fetchJSON(PARENT_BASE) as { body: Record<string, unknown> }
      const data = body.data as Record<string, unknown>
      expect(data).toBeDefined()
      expect(data.service).toBe('example.com.ai')
      expect(data.description).toBe('Digital Object API')
    })

    it('should have a timestamp', async () => {
      const { body } = await fetchJSON(PARENT_BASE) as { body: Record<string, unknown> }
      expect(body.timestamp).toBeDefined()
      expect(typeof body.timestamp).toBe('number')
      // Timestamp should be recent (within last 60 seconds)
      const now = Date.now()
      expect(body.timestamp as number).toBeGreaterThan(now - 60_000)
      expect(body.timestamp as number).toBeLessThanOrEqual(now + 5_000)
    })

    it('should have all expected HATEOAS links', async () => {
      const { body } = await fetchJSON(PARENT_BASE) as { body: Record<string, unknown> }
      const links = body.links as Record<string, string>
      expect(links).toBeDefined()

      for (const key of EXPECTED_LINK_PATHS) {
        expect(links[key]).toBeDefined()
        expect(typeof links[key]).toBe('string')
      }
    })

    it('should have links pointing to the correct parent domain', async () => {
      const { body } = await fetchJSON(PARENT_BASE) as { body: Record<string, unknown> }
      const links = body.links as Record<string, string>

      expect(links.self).toBe('https://example.com.ai')
      expect(links.identity).toBe('https://example.com.ai/.do')
      expect(links.api).toBe('https://example.com.ai/api')
      expect(links.rpc).toBe('https://example.com.ai/rpc')
      expect(links.mcp).toBe('https://example.com.ai/mcp')
      expect(links.health).toBe('https://example.com.ai/_health')
      expect(links.docs).toBe('https://do.md')
    })

    it('should return application/json content-type', async () => {
      const { headers } = await fetchJSON(PARENT_BASE)
      const contentType = headers.get('content-type')
      expect(contentType).toContain('application/json')
    })
  })

  describe('GET /_health — health endpoint', () => {
    it('should return 200', async () => {
      const { status } = await fetchJSON(`${PARENT_BASE}/_health`)
      expect(status).toBe(200)
    })

    it('should return status ok', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/_health`) as { body: Record<string, unknown> }
      expect(body.status).toBe('ok')
    })

    it('should include a timestamp', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/_health`) as { body: Record<string, unknown> }
      expect(body.timestamp).toBeDefined()
      expect(typeof body.timestamp).toBe('number')
    })
  })

  describe('GET /.do — identity endpoint', () => {
    it('should return 200 with valid JSON', async () => {
      const { status, body } = await fetchJSON(`${PARENT_BASE}/.do`)
      expect(status).toBe(200)
      expect(body).toBeDefined()
    })

    it('should have the correct api field', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/.do`) as { body: Record<string, unknown> }
      expect(body.api).toBe('example.com.ai')
    })

    it('should have links including self and root', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/.do`) as { body: Record<string, unknown> }
      const links = body.links as Record<string, string>
      expect(links).toBeDefined()
      expect(links.self).toBe('https://example.com.ai/.do')
      expect(links.root).toBe('https://example.com.ai')
    })
  })

  describe('GET /api — API endpoint', () => {
    it('should return 200 with valid JSON', async () => {
      const { status, body } = await fetchJSON(`${PARENT_BASE}/api`)
      expect(status).toBe(200)
      expect(body).toBeDefined()
    })

    it('should have the correct api field', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/api`) as { body: Record<string, unknown> }
      expect(body.api).toBe('example.com.ai')
    })

    it('should describe REST-style API', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/api`) as { body: Record<string, unknown> }
      const data = body.data as Record<string, unknown>
      expect(data).toBeDefined()
      expect(data.description).toContain('API')
      expect(data.version).toBeDefined()
    })

    it('should have collection links for nouns, things, actions, etc.', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/api`) as { body: Record<string, unknown> }
      const links = body.links as Record<string, string>
      expect(links).toBeDefined()
      expect(links.self).toBe('https://example.com.ai/api')
      expect(links.nouns).toBe('https://example.com.ai/api/nouns')
      expect(links.things).toBe('https://example.com.ai/api/things')
      expect(links.actions).toBe('https://example.com.ai/api/actions')
    })
  })

  describe('GET /rpc — RPC endpoint', () => {
    it('should return 200 with valid JSON', async () => {
      const { status, body } = await fetchJSON(`${PARENT_BASE}/rpc`)
      expect(status).toBe(200)
      expect(body).toBeDefined()
    })

    it('should have the correct api field', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/rpc`) as { body: Record<string, unknown> }
      expect(body.api).toBe('example.com.ai')
    })

    it('should describe RPC usage', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/rpc`) as { body: Record<string, unknown> }
      const data = body.data as Record<string, unknown>
      expect(data).toBeDefined()
      expect(data.description).toContain('RPC')
    })
  })

  describe('GET /mcp — MCP endpoint', () => {
    it('should return 200 with valid JSON', async () => {
      const { status, body } = await fetchJSON(`${PARENT_BASE}/mcp`)
      expect(status).toBe(200)
      expect(body).toBeDefined()
    })

    it('should include MCP protocol version', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/mcp`) as { body: Record<string, unknown> }
      expect(body.protocolVersion).toBeDefined()
      expect(typeof body.protocolVersion).toBe('string')
    })

    it('should include server info with correct name', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/mcp`) as { body: Record<string, unknown> }
      const serverInfo = body.serverInfo as Record<string, unknown>
      expect(serverInfo).toBeDefined()
      expect(serverInfo.name).toBe('example.com.ai')
      expect(serverInfo.version).toBeDefined()
    })

    it('should declare capabilities for tools, resources, and prompts', async () => {
      const { body } = await fetchJSON(`${PARENT_BASE}/mcp`) as { body: Record<string, unknown> }
      const capabilities = body.capabilities as Record<string, unknown>
      expect(capabilities).toBeDefined()
      expect(capabilities.tools).toBeDefined()
      expect(capabilities.resources).toBeDefined()
      expect(capabilities.prompts).toBeDefined()
    })
  })

  describe('CORS headers', () => {
    it('should include Access-Control-Allow-Origin header', async () => {
      const { headers } = await fetchJSON(PARENT_BASE)
      const acao = headers.get('access-control-allow-origin')
      expect(acao).toBeDefined()
      expect(acao).toBe('*')
    })
  })
})

// ============================================================================
// Tenant Domain: crm.example.com.ai
// ============================================================================

describe('crm.example.com.ai (tenant subdomain)', () => {
  describe('GET / — root endpoint', () => {
    it('should return 200 with valid JSON', async () => {
      const { status, body } = await fetchJSON(TENANT_BASE)
      expect(status).toBe(200)
      expect(body).toBeDefined()
      expect(typeof body).toBe('object')
    })

    it('should have the correct api field scoped to crm subdomain', async () => {
      const { body } = await fetchJSON(TENANT_BASE) as { body: Record<string, unknown> }
      expect(body.api).toBe('crm.example.com.ai')
    })

    it('should have data with service scoped to crm subdomain', async () => {
      const { body } = await fetchJSON(TENANT_BASE) as { body: Record<string, unknown> }
      const data = body.data as Record<string, unknown>
      expect(data).toBeDefined()
      expect(data.service).toBe('crm.example.com.ai')
      expect(data.description).toBe('Digital Object API')
    })

    it('should have a timestamp', async () => {
      const { body } = await fetchJSON(TENANT_BASE) as { body: Record<string, unknown> }
      expect(body.timestamp).toBeDefined()
      expect(typeof body.timestamp).toBe('number')
    })

    it('should have all expected HATEOAS links', async () => {
      const { body } = await fetchJSON(TENANT_BASE) as { body: Record<string, unknown> }
      const links = body.links as Record<string, string>
      expect(links).toBeDefined()

      for (const key of EXPECTED_LINK_PATHS) {
        expect(links[key]).toBeDefined()
        expect(typeof links[key]).toBe('string')
      }
    })

    it('should have links pointing to the crm subdomain', async () => {
      const { body } = await fetchJSON(TENANT_BASE) as { body: Record<string, unknown> }
      const links = body.links as Record<string, string>

      expect(links.self).toBe('https://crm.example.com.ai')
      expect(links.identity).toBe('https://crm.example.com.ai/.do')
      expect(links.api).toBe('https://crm.example.com.ai/api')
      expect(links.rpc).toBe('https://crm.example.com.ai/rpc')
      expect(links.mcp).toBe('https://crm.example.com.ai/mcp')
      expect(links.health).toBe('https://crm.example.com.ai/_health')
      expect(links.docs).toBe('https://do.md')
    })

    it('should return application/json content-type', async () => {
      const { headers } = await fetchJSON(TENANT_BASE)
      const contentType = headers.get('content-type')
      expect(contentType).toContain('application/json')
    })
  })

  describe('GET /_health — health endpoint', () => {
    it('should return 200', async () => {
      const { status } = await fetchJSON(`${TENANT_BASE}/_health`)
      expect(status).toBe(200)
    })

    it('should return status ok', async () => {
      const { body } = await fetchJSON(`${TENANT_BASE}/_health`) as { body: Record<string, unknown> }
      expect(body.status).toBe('ok')
    })

    it('should include a timestamp', async () => {
      const { body } = await fetchJSON(`${TENANT_BASE}/_health`) as { body: Record<string, unknown> }
      expect(body.timestamp).toBeDefined()
      expect(typeof body.timestamp).toBe('number')
    })
  })

  describe('GET /api — API endpoint', () => {
    it('should return 200 with valid JSON', async () => {
      const { status, body } = await fetchJSON(`${TENANT_BASE}/api`)
      expect(status).toBe(200)
      expect(body).toBeDefined()
    })

    it('should have the correct api field scoped to crm', async () => {
      const { body } = await fetchJSON(`${TENANT_BASE}/api`) as { body: Record<string, unknown> }
      expect(body.api).toBe('crm.example.com.ai')
    })

    it('should have collection links scoped to crm subdomain', async () => {
      const { body } = await fetchJSON(`${TENANT_BASE}/api`) as { body: Record<string, unknown> }
      const links = body.links as Record<string, string>
      expect(links).toBeDefined()
      expect(links.self).toBe('https://crm.example.com.ai/api')
      expect(links.nouns).toBe('https://crm.example.com.ai/api/nouns')
      expect(links.things).toBe('https://crm.example.com.ai/api/things')
    })
  })

  describe('GET /rpc — RPC endpoint', () => {
    it('should return 200 with valid JSON', async () => {
      const { status, body } = await fetchJSON(`${TENANT_BASE}/rpc`)
      expect(status).toBe(200)
      expect(body).toBeDefined()
    })

    it('should have the correct api field scoped to crm', async () => {
      const { body } = await fetchJSON(`${TENANT_BASE}/rpc`) as { body: Record<string, unknown> }
      expect(body.api).toBe('crm.example.com.ai')
    })
  })

  describe('GET /mcp — MCP endpoint', () => {
    it('should return 200 with valid JSON', async () => {
      const { status, body } = await fetchJSON(`${TENANT_BASE}/mcp`)
      expect(status).toBe(200)
      expect(body).toBeDefined()
    })

    it('should include server info with crm subdomain name', async () => {
      const { body } = await fetchJSON(`${TENANT_BASE}/mcp`) as { body: Record<string, unknown> }
      const serverInfo = body.serverInfo as Record<string, unknown>
      expect(serverInfo).toBeDefined()
      expect(serverInfo.name).toBe('crm.example.com.ai')
    })
  })

  describe('CORS headers', () => {
    it('should include Access-Control-Allow-Origin header', async () => {
      const { headers } = await fetchJSON(TENANT_BASE)
      const acao = headers.get('access-control-allow-origin')
      expect(acao).toBeDefined()
      expect(acao).toBe('*')
    })
  })
})

// ============================================================================
// Cross-domain consistency
// ============================================================================

describe('cross-domain consistency', () => {
  it('parent and tenant should have the same response shape', async () => {
    const { body: parentBody } = await fetchJSON(PARENT_BASE) as { body: Record<string, unknown> }
    const { body: tenantBody } = await fetchJSON(TENANT_BASE) as { body: Record<string, unknown> }

    // Same top-level keys
    const parentKeys = Object.keys(parentBody).sort()
    const tenantKeys = Object.keys(tenantBody).sort()
    expect(parentKeys).toEqual(tenantKeys)

    // Same link keys
    const parentLinkKeys = Object.keys(parentBody.links as Record<string, unknown>).sort()
    const tenantLinkKeys = Object.keys(tenantBody.links as Record<string, unknown>).sort()
    expect(parentLinkKeys).toEqual(tenantLinkKeys)
  })

  it('parent and tenant should have the same data shape', async () => {
    const { body: parentBody } = await fetchJSON(PARENT_BASE) as { body: Record<string, unknown> }
    const { body: tenantBody } = await fetchJSON(TENANT_BASE) as { body: Record<string, unknown> }

    const parentData = parentBody.data as Record<string, unknown>
    const tenantData = tenantBody.data as Record<string, unknown>

    const parentDataKeys = Object.keys(parentData).sort()
    const tenantDataKeys = Object.keys(tenantData).sort()
    expect(parentDataKeys).toEqual(tenantDataKeys)
  })

  it('docs link should be the same for both domains', async () => {
    const { body: parentBody } = await fetchJSON(PARENT_BASE) as { body: Record<string, unknown> }
    const { body: tenantBody } = await fetchJSON(TENANT_BASE) as { body: Record<string, unknown> }

    const parentLinks = parentBody.links as Record<string, string>
    const tenantLinks = tenantBody.links as Record<string, string>

    expect(parentLinks.docs).toBe(tenantLinks.docs)
    expect(parentLinks.docs).toBe('https://do.md')
  })

  it('health endpoints should both report ok', async () => {
    const { body: parentHealth } = await fetchJSON(`${PARENT_BASE}/_health`) as { body: Record<string, unknown> }
    const { body: tenantHealth } = await fetchJSON(`${TENANT_BASE}/_health`) as { body: Record<string, unknown> }

    expect(parentHealth.status).toBe('ok')
    expect(tenantHealth.status).toBe('ok')
  })

  it('API endpoints should have the same data shape', async () => {
    const { body: parentApi } = await fetchJSON(`${PARENT_BASE}/api`) as { body: Record<string, unknown> }
    const { body: tenantApi } = await fetchJSON(`${TENANT_BASE}/api`) as { body: Record<string, unknown> }

    const parentApiKeys = Object.keys(parentApi).sort()
    const tenantApiKeys = Object.keys(tenantApi).sort()
    expect(parentApiKeys).toEqual(tenantApiKeys)

    // Both should have same link keys (but different domains)
    const parentApiLinkKeys = Object.keys(parentApi.links as Record<string, unknown>).sort()
    const tenantApiLinkKeys = Object.keys(tenantApi.links as Record<string, unknown>).sort()
    expect(parentApiLinkKeys).toEqual(tenantApiLinkKeys)
  })

  it('MCP endpoints should have the same capabilities', async () => {
    const { body: parentMcp } = await fetchJSON(`${PARENT_BASE}/mcp`) as { body: Record<string, unknown> }
    const { body: tenantMcp } = await fetchJSON(`${TENANT_BASE}/mcp`) as { body: Record<string, unknown> }

    expect(parentMcp.protocolVersion).toBe(tenantMcp.protocolVersion)

    const parentCaps = parentMcp.capabilities as Record<string, unknown>
    const tenantCaps = tenantMcp.capabilities as Record<string, unknown>

    const parentCapKeys = Object.keys(parentCaps).sort()
    const tenantCapKeys = Object.keys(tenantCaps).sort()
    expect(parentCapKeys).toEqual(tenantCapKeys)
  })
})
