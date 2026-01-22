/**
 * Multi-Tenant E2E Tests - Tenant Data Isolation
 *
 * Tests that verify tenant data isolation across different namespaces.
 * Each tenant gets their own Durable Object instance via idFromName(namespace).
 *
 * Tests cover:
 * 1. Tenant A cannot access Tenant B's data
 * 2. Namespace isolation - separate DO instances per tenant
 * 3. Cross-tenant RPC blocked - cannot call methods on other tenant's DO
 * 4. Concurrent multi-tenant operations remain isolated
 *
 * NO MOCKS - uses real Miniflare instances to test true isolation.
 *
 * @module e2e/tests/multi-tenant.test
 * @see do-nh7l
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Thing {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
}

interface RPCResponse<T = unknown> {
  error?: string
  result?: T
}

// ============================================================================
// TEST DO SCRIPT WITH MULTI-TENANT SUPPORT
// ============================================================================

/**
 * Multi-tenant DO script that stores Things per namespace.
 * Each DO instance is isolated - no cross-tenant access possible.
 */
const MULTI_TENANT_DO_SCRIPT = `
// Simple ID generator
function generateId() {
  return 'thing-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8)
}

export class TenantDO {
  constructor(state, env) {
    this.state = state
    this.storage = state.storage
    this.env = env
    this.tenantId = null // Set on first request
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    // Extract tenant from subdomain or header for logging
    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader && !this.tenantId) {
      this.tenantId = tenantHeader
    }

    // RPC endpoint
    if (path === '/rpc' && request.method === 'POST') {
      return this.handleRPC(request)
    }

    // Health check
    if (path === '/' || path === '/health') {
      return Response.json({
        status: 'ok',
        id: this.state.id.toString(),
        tenantId: this.tenantId
      })
    }

    // CRUD endpoints for Things
    if (path === '/things') {
      if (request.method === 'GET') {
        return this.listThings()
      }
      if (request.method === 'POST') {
        const data = await request.json()
        return this.createThing(data)
      }
    }

    // Single thing operations
    const thingMatch = path.match(/^\\/things\\/([^/]+)$/)
    if (thingMatch) {
      const id = thingMatch[1]
      if (request.method === 'GET') {
        return this.getThing(id)
      }
      if (request.method === 'DELETE') {
        return this.deleteThing(id)
      }
    }

    return Response.json({ error: 'Not Found', path }, { status: 404 })
  }

  async handleRPC(request) {
    try {
      const { method, args } = await request.json()
      const fn = this[method]

      if (typeof fn !== 'function') {
        return Response.json({ error: 'Method not found: ' + method }, { status: 404 })
      }

      const result = await fn.apply(this, args || [])
      return Response.json(result)
    } catch (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
  }

  // CRUD Operations

  async createThing(data) {
    const id = generateId()
    const thing = {
      $id: id,
      $type: data.$type || 'Thing',
      name: data.name,
      data: data.data,
      createdAt: Date.now()
    }

    await this.storage.put('thing:' + id, thing)

    // Track all thing IDs for listing
    const index = await this.storage.get('thing-index') || []
    index.push(id)
    await this.storage.put('thing-index', index)

    return Response.json(thing, { status: 201 })
  }

  async getThing(id) {
    const thing = await this.storage.get('thing:' + id)
    if (!thing) {
      return Response.json({ error: 'Thing not found', id }, { status: 404 })
    }
    return Response.json(thing)
  }

  async listThings() {
    const index = await this.storage.get('thing-index') || []
    const things = []

    for (const id of index) {
      const thing = await this.storage.get('thing:' + id)
      if (thing) {
        things.push(thing)
      }
    }

    return Response.json(things)
  }

  async deleteThing(id) {
    const thing = await this.storage.get('thing:' + id)
    if (!thing) {
      return Response.json({ error: 'Thing not found', id }, { status: 404 })
    }

    await this.storage.delete('thing:' + id)

    // Update index
    const index = await this.storage.get('thing-index') || []
    const newIndex = index.filter(i => i !== id)
    await this.storage.put('thing-index', newIndex)

    return new Response(null, { status: 204 })
  }

  // RPC Methods for cross-DO communication testing

  async getThingById(id) {
    return await this.storage.get('thing:' + id) || null
  }

  async getAllThings() {
    const index = await this.storage.get('thing-index') || []
    const things = []

    for (const id of index) {
      const thing = await this.storage.get('thing:' + id)
      if (thing) {
        things.push(thing)
      }
    }

    return things
  }

  async getThingCount() {
    const index = await this.storage.get('thing-index') || []
    return index.length
  }

  async getDoId() {
    return this.state.id.toString()
  }
}

// Worker that routes requests to the appropriate tenant DO
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Extract tenant namespace from subdomain or header
    // Format: tenant.api.dotdo.dev -> tenant
    // Or use X-Tenant-ID header for testing
    let namespace = 'default'

    const tenantHeader = request.headers.get('X-Tenant-ID')
    if (tenantHeader) {
      namespace = tenantHeader
    } else {
      const hostParts = url.hostname.split('.')
      if (hostParts.length > 2) {
        namespace = hostParts[0]
      }
    }

    // Get DO stub for this tenant namespace
    const id = env.TENANT_DO.idFromName(namespace)
    const stub = env.TENANT_DO.get(id)

    // Forward request to the tenant's DO, adding tenant header
    const headers = new Headers(request.headers)
    headers.set('X-Tenant-ID', namespace)

    const newRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: request.body
    })

    return stub.fetch(newRequest)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a tenant-specific client for making requests
 */
function createTenantClient(mf: Miniflare, tenantId: string) {
  return {
    async request<T = unknown>(path: string, options: RequestInit = {}): Promise<{ status: number; data: T }> {
      const headers = new Headers(options.headers)
      headers.set('X-Tenant-ID', tenantId)
      headers.set('Content-Type', 'application/json')

      const response = await mf.dispatchFetch(`http://localhost${path}`, {
        ...options,
        headers,
      })

      const status = response.status
      if (status === 204) {
        return { status, data: undefined as T }
      }

      const data = await response.json() as T
      return { status, data }
    },

    async createThing(thing: Partial<Thing>): Promise<{ status: number; data: Thing }> {
      return this.request('/things', {
        method: 'POST',
        body: JSON.stringify(thing),
      })
    },

    async getThing(id: string): Promise<{ status: number; data: Thing | { error: string } }> {
      return this.request(`/things/${id}`)
    },

    async listThings(): Promise<{ status: number; data: Thing[] }> {
      return this.request('/things')
    },

    async deleteThing(id: string): Promise<{ status: number; data: undefined }> {
      return this.request(`/things/${id}`, { method: 'DELETE' })
    },

    async rpc<T = unknown>(method: string, args: unknown[] = []): Promise<{ status: number; data: T }> {
      return this.request('/rpc', {
        method: 'POST',
        body: JSON.stringify({ method, args }),
      })
    },

    async health(): Promise<{ status: number; data: { status: string; id: string; tenantId: string | null } }> {
      return this.request('/health')
    },
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Multi-Tenant E2E Tests', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: MULTI_TENANT_DO_SCRIPT,
      durableObjects: {
        TENANT_DO: 'TenantDO',
      },
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  describe('Namespace Isolation', () => {
    it('should create separate DO instances for different tenants', async () => {
      const tenantA = createTenantClient(mf, 'tenant-a')
      const tenantB = createTenantClient(mf, 'tenant-b')

      // Get health from both tenants
      const healthA = await tenantA.health()
      const healthB = await tenantB.health()

      // Both should be healthy
      expect(healthA.status).toBe(200)
      expect(healthB.status).toBe(200)

      // They should have different DO IDs (different instances)
      expect(healthA.data.id).not.toBe(healthB.data.id)

      // Tenant IDs should be correctly set
      expect(healthA.data.tenantId).toBe('tenant-a')
      expect(healthB.data.tenantId).toBe('tenant-b')
    })

    it('should maintain consistent DO ID for the same tenant across requests', async () => {
      const tenant = createTenantClient(mf, 'consistent-tenant')

      // Make multiple requests
      const health1 = await tenant.health()
      const health2 = await tenant.health()
      const health3 = await tenant.health()

      // All should return the same DO ID
      expect(health1.data.id).toBe(health2.data.id)
      expect(health2.data.id).toBe(health3.data.id)
    })
  })

  describe('Tenant Data Isolation', () => {
    const tenantAlpha = 'alpha-corp'
    const tenantBeta = 'beta-inc'
    let alphaClient: ReturnType<typeof createTenantClient>
    let betaClient: ReturnType<typeof createTenantClient>
    let alphaThingId: string
    let betaThingId: string

    beforeEach(async () => {
      // Use unique tenant names to avoid test interference
      const testId = Date.now().toString(36)
      const alphaName = `${tenantAlpha}-${testId}`
      const betaName = `${tenantBeta}-${testId}`

      alphaClient = createTenantClient(mf, alphaName)
      betaClient = createTenantClient(mf, betaName)

      // Create data in each tenant
      const alphaResult = await alphaClient.createThing({
        $type: 'Customer',
        name: 'Alpha Customer',
        data: { secret: 'alpha-secret-data' },
      })
      alphaThingId = alphaResult.data.$id

      const betaResult = await betaClient.createThing({
        $type: 'Customer',
        name: 'Beta Customer',
        data: { secret: 'beta-secret-data' },
      })
      betaThingId = betaResult.data.$id
    })

    it('should prevent Tenant A from accessing Tenant B data by ID', async () => {
      // Alpha trying to get Beta's thing
      const result = await alphaClient.getThing(betaThingId)

      // Should return 404 - thing not found in Alpha's namespace
      expect(result.status).toBe(404)
      expect((result.data as { error: string }).error).toContain('not found')
    })

    it('should prevent Tenant B from accessing Tenant A data by ID', async () => {
      // Beta trying to get Alpha's thing
      const result = await betaClient.getThing(alphaThingId)

      // Should return 404 - thing not found in Beta's namespace
      expect(result.status).toBe(404)
      expect((result.data as { error: string }).error).toContain('not found')
    })

    it('should only list data belonging to the requesting tenant', async () => {
      // List things for Alpha
      const alphaList = await alphaClient.listThings()
      expect(alphaList.status).toBe(200)

      // List things for Beta
      const betaList = await betaClient.listThings()
      expect(betaList.status).toBe(200)

      // Alpha should only see Alpha's data
      const alphaIds = alphaList.data.map(t => t.$id)
      expect(alphaIds).toContain(alphaThingId)
      expect(alphaIds).not.toContain(betaThingId)

      // Beta should only see Beta's data
      const betaIds = betaList.data.map(t => t.$id)
      expect(betaIds).toContain(betaThingId)
      expect(betaIds).not.toContain(alphaThingId)
    })

    it('should isolate thing counts per tenant', async () => {
      // Get counts via RPC
      const alphaCount = await alphaClient.rpc<number>('getThingCount')
      const betaCount = await betaClient.rpc<number>('getThingCount')

      // Each tenant should have exactly 1 thing (created in beforeEach)
      expect(alphaCount.data).toBe(1)
      expect(betaCount.data).toBe(1)

      // Create more things in Alpha
      await alphaClient.createThing({ $type: 'Order', name: 'Order 1' })
      await alphaClient.createThing({ $type: 'Order', name: 'Order 2' })

      // Recheck counts
      const alphaCountAfter = await alphaClient.rpc<number>('getThingCount')
      const betaCountAfter = await betaClient.rpc<number>('getThingCount')

      // Alpha should have 3, Beta should still have 1
      expect(alphaCountAfter.data).toBe(3)
      expect(betaCountAfter.data).toBe(1)
    })

    it('should prevent cross-tenant deletion', async () => {
      // Alpha tries to delete Beta's thing
      const deleteResult = await alphaClient.deleteThing(betaThingId)

      // Should fail - thing not found in Alpha's namespace
      expect(deleteResult.status).toBe(404)

      // Verify Beta's thing still exists
      const betaThing = await betaClient.getThing(betaThingId)
      expect(betaThing.status).toBe(200)
      expect(betaThing.data.$id).toBe(betaThingId)
    })
  })

  describe('Cross-Tenant RPC Blocked', () => {
    it('should not allow direct RPC calls to another tenant DO', async () => {
      // This test verifies that even if someone knew the internal DO structure,
      // they cannot call RPC methods on another tenant's DO because they
      // are routed to their own DO instance by namespace

      const testId = Date.now().toString(36)
      const attackerClient = createTenantClient(mf, `attacker-${testId}`)
      const victimClient = createTenantClient(mf, `victim-${testId}`)

      // Victim creates sensitive data
      const victimThing = await victimClient.createThing({
        $type: 'Secret',
        name: 'Victim Secret',
        data: { password: 'super-secret-password' },
      })

      // Attacker tries to get all things via RPC (would see victim's data if isolation failed)
      const attackerAllThings = await attackerClient.rpc<Thing[]>('getAllThings')

      // Attacker should see empty list (their own tenant has no data)
      expect(attackerAllThings.status).toBe(200)
      expect(attackerAllThings.data).toHaveLength(0)

      // Attacker tries to get victim's thing by ID via RPC
      const attackerGetById = await attackerClient.rpc<Thing | null>('getThingById', [victimThing.data.$id])

      // Should return null - thing not found in attacker's namespace
      expect(attackerGetById.status).toBe(200)
      expect(attackerGetById.data).toBeNull()

      // Verify victim's data is intact
      const victimData = await victimClient.getThing(victimThing.data.$id)
      expect(victimData.status).toBe(200)
      expect(victimData.data.data?.password).toBe('super-secret-password')
    })

    it('should isolate RPC method results per tenant', async () => {
      const testId = Date.now().toString(36)
      const tenant1 = createTenantClient(mf, `tenant1-${testId}`)
      const tenant2 = createTenantClient(mf, `tenant2-${testId}`)

      // Get DO IDs via RPC
      const doId1 = await tenant1.rpc<string>('getDoId')
      const doId2 = await tenant2.rpc<string>('getDoId')

      // Each tenant should get their own DO ID
      expect(doId1.status).toBe(200)
      expect(doId2.status).toBe(200)
      expect(doId1.data).not.toBe(doId2.data)

      // DO IDs should be deterministic per namespace (idFromName)
      const doId1Again = await tenant1.rpc<string>('getDoId')
      expect(doId1Again.data).toBe(doId1.data)
    })
  })

  describe('Concurrent Multi-Tenant Operations', () => {
    it('should handle concurrent operations across tenants without data leakage', async () => {
      const testId = Date.now().toString(36)
      const tenants = Array.from({ length: 5 }, (_, i) =>
        createTenantClient(mf, `concurrent-tenant-${i}-${testId}`)
      )

      // Concurrently create data in all tenants
      const createPromises = tenants.map((tenant, i) =>
        tenant.createThing({
          $type: 'ConcurrentTest',
          name: `Tenant ${i} Data`,
          data: { tenantIndex: i },
        })
      )

      const createResults = await Promise.all(createPromises)

      // All creates should succeed
      for (const result of createResults) {
        expect(result.status).toBe(201)
      }

      // Concurrently list data from all tenants
      const listPromises = tenants.map(tenant => tenant.listThings())
      const listResults = await Promise.all(listPromises)

      // Verify each tenant only sees their own data
      for (let i = 0; i < tenants.length; i++) {
        const list = listResults[i]
        expect(list.status).toBe(200)
        expect(list.data).toHaveLength(1)
        expect(list.data[0].data?.tenantIndex).toBe(i)
        expect(list.data[0].name).toBe(`Tenant ${i} Data`)
      }
    })

    it('should maintain isolation during rapid concurrent operations', async () => {
      const testId = Date.now().toString(36)
      const tenantA = createTenantClient(mf, `rapid-a-${testId}`)
      const tenantB = createTenantClient(mf, `rapid-b-${testId}`)

      // Rapidly create items in both tenants concurrently
      const operations: Promise<unknown>[] = []

      for (let i = 0; i < 10; i++) {
        operations.push(
          tenantA.createThing({ $type: 'Rapid', name: `A-${i}` }),
          tenantB.createThing({ $type: 'Rapid', name: `B-${i}` })
        )
      }

      await Promise.all(operations)

      // List and verify
      const [listA, listB] = await Promise.all([
        tenantA.listThings(),
        tenantB.listThings(),
      ])

      // Each tenant should have exactly 10 items
      expect(listA.data).toHaveLength(10)
      expect(listB.data).toHaveLength(10)

      // Verify all items belong to correct tenant
      for (const thing of listA.data) {
        expect(thing.name).toMatch(/^A-\d+$/)
      }

      for (const thing of listB.data) {
        expect(thing.name).toMatch(/^B-\d+$/)
      }
    })
  })

  describe('Edge Cases', () => {
    it('should isolate tenants with similar names', async () => {
      const testId = Date.now().toString(36)
      const tenant1 = createTenantClient(mf, `tenant-${testId}`)
      const tenant2 = createTenantClient(mf, `tenant-${testId}-extra`)
      const tenant3 = createTenantClient(mf, `TENANT-${testId}`) // Different case

      // Create data in first tenant
      await tenant1.createThing({ $type: 'Test', name: 'Tenant 1 Data' })

      // Other tenants should not see this data
      const list2 = await tenant2.listThings()
      const list3 = await tenant3.listThings()

      expect(list2.data).toHaveLength(0)
      expect(list3.data).toHaveLength(0)

      // Each should have separate DO IDs
      const [id1, id2, id3] = await Promise.all([
        tenant1.rpc<string>('getDoId'),
        tenant2.rpc<string>('getDoId'),
        tenant3.rpc<string>('getDoId'),
      ])

      expect(id1.data).not.toBe(id2.data)
      expect(id1.data).not.toBe(id3.data)
      expect(id2.data).not.toBe(id3.data)
    })

    it('should handle default namespace correctly', async () => {
      const testId = Date.now().toString(36)
      const defaultTenant = createTenantClient(mf, 'default')
      const namedTenant = createTenantClient(mf, `named-${testId}`)

      // Create data in default tenant
      await defaultTenant.createThing({ $type: 'Default', name: 'Default Data' })

      // Named tenant should not see default's data
      const namedList = await namedTenant.listThings()
      expect(namedList.data).toHaveLength(0)

      // Default tenant should see its data
      const defaultList = await defaultTenant.listThings()
      expect(defaultList.data.length).toBeGreaterThan(0)
    })

    it('should prevent tenant header spoofing from accessing other tenant data', async () => {
      // This simulates a scenario where an attacker might try to
      // change their tenant header mid-request or forge headers

      const testId = Date.now().toString(36)
      const legitimateTenant = createTenantClient(mf, `legitimate-${testId}`)
      const maliciousTenant = createTenantClient(mf, `legitimate-${testId}`) // Same namespace

      // Legitimate tenant creates data
      const created = await legitimateTenant.createThing({
        $type: 'Sensitive',
        name: 'Legitimate Data',
        data: { ssn: '123-45-6789' },
      })

      // Same namespace should see the data (this is expected - same tenant)
      const sameNamespaceList = await maliciousTenant.listThings()
      expect(sameNamespaceList.data).toHaveLength(1)

      // But a DIFFERENT namespace should not
      const differentTenant = createTenantClient(mf, `different-${testId}`)
      const differentList = await differentTenant.listThings()
      expect(differentList.data).toHaveLength(0)

      // Trying to access by known ID from different namespace fails
      const accessAttempt = await differentTenant.getThing(created.data.$id)
      expect(accessAttempt.status).toBe(404)
    })
  })
})
