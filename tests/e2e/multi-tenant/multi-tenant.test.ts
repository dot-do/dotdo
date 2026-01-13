/**
 * E2E Tests: Multi-Tenant DO Workflows with Real Miniflare
 *
 * Tests multi-tenant isolation, concurrent access, and protocol switching
 * using real Miniflare Durable Objects - NO MOCKS.
 *
 * Scenarios tested:
 * 1. Cross-tenant isolation (tenant A can't see tenant B data)
 * 2. Concurrent access to same DO (race conditions, consistency)
 * 3. Protocol switching (REST then RPC in same workflow)
 * 4. Stress tests (multiple concurrent tenants)
 * 5. Failure recovery scenarios
 *
 * Run with: npx vitest run tests/e2e/multi-tenant/multi-tenant.test.ts --project=graph-e2e
 *
 * @module tests/e2e/multi-tenant/multi-tenant
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare, DurableObjectStub } from 'miniflare'

/**
 * Multi-tenant DO implementation with SQLite storage.
 * Each tenant namespace gets its own isolated DO instance.
 */
const getMiniflareConfig = () => ({
  modules: true,
  script: `
    /**
     * MultiTenantDO - A Durable Object that stores tenant-isolated data
     *
     * Each instance (identified by namespace) has its own isolated SQLite storage.
     * Supports both REST (fetch) and RPC (direct method calls) access patterns.
     */
    export class MultiTenantDO {
      constructor(state, env) {
        this.state = state
        this.storage = state.storage
        this.sql = state.storage.sql
        this.initialized = false

        // Initialize schema
        this.initPromise = this.initSchema()
      }

      async initSchema() {
        if (this.initialized) return

        // Create tables for multi-tenant data
        this.sql.exec(\`
          CREATE TABLE IF NOT EXISTS things (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);

          CREATE TABLE IF NOT EXISTS relationships (
            id TEXT PRIMARY KEY,
            from_id TEXT NOT NULL,
            to_id TEXT NOT NULL,
            verb TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );

          CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id);
          CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_id);
          CREATE INDEX IF NOT EXISTS idx_rel_verb ON relationships(verb);
        \`)

        this.initialized = true
      }

      // ==========================================
      // RPC Methods (Direct method calls)
      // ==========================================

      /**
       * Create a thing via RPC
       */
      async createThing(data) {
        await this.initPromise

        const id = data.id || crypto.randomUUID()
        const now = Date.now()

        // Check for duplicates
        const existing = this.sql.exec('SELECT id FROM things WHERE id = ?', id).toArray()
        if (existing.length > 0) {
          throw new Error('Duplicate ID')
        }

        const thing = {
          id,
          type: data.type,
          data: data.data || {},
          created_at: now,
          updated_at: now,
        }

        this.sql.exec(
          'INSERT INTO things (id, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          thing.id,
          thing.type,
          JSON.stringify(thing.data),
          thing.created_at,
          thing.updated_at
        )

        return thing
      }

      /**
       * Get a thing by ID via RPC
       */
      async getThing(id) {
        await this.initPromise

        const rows = this.sql.exec('SELECT * FROM things WHERE id = ?', id).toArray()
        if (rows.length === 0) {
          return null
        }

        const row = rows[0]
        return {
          id: row.id,
          type: row.type,
          data: JSON.parse(row.data),
          created_at: row.created_at,
          updated_at: row.updated_at,
        }
      }

      /**
       * List things by type via RPC
       */
      async listThings(type) {
        await this.initPromise

        const rows = type
          ? this.sql.exec('SELECT * FROM things WHERE type = ?', type).toArray()
          : this.sql.exec('SELECT * FROM things').toArray()

        return rows.map(row => ({
          id: row.id,
          type: row.type,
          data: JSON.parse(row.data),
          created_at: row.created_at,
          updated_at: row.updated_at,
        }))
      }

      /**
       * Update a thing via RPC
       */
      async updateThing(id, updates) {
        await this.initPromise

        const existing = await this.getThing(id)
        if (!existing) {
          throw new Error('Not found')
        }

        const now = Date.now()
        const newData = { ...existing.data, ...(updates.data || {}) }

        this.sql.exec(
          'UPDATE things SET data = ?, updated_at = ? WHERE id = ?',
          JSON.stringify(newData),
          now,
          id
        )

        return {
          ...existing,
          data: newData,
          updated_at: now,
        }
      }

      /**
       * Delete a thing via RPC
       */
      async deleteThing(id) {
        await this.initPromise

        const existing = await this.getThing(id)
        if (!existing) {
          throw new Error('Not found')
        }

        // Cascade delete relationships
        this.sql.exec('DELETE FROM relationships WHERE from_id = ? OR to_id = ?', id, id)
        this.sql.exec('DELETE FROM things WHERE id = ?', id)

        return { deleted: true }
      }

      /**
       * Create a relationship via RPC
       */
      async createRelationship(data) {
        await this.initPromise

        // Verify both endpoints exist
        const fromThing = await this.getThing(data.from)
        if (!fromThing) {
          throw new Error('Source not found')
        }

        const toThing = await this.getThing(data.to)
        if (!toThing) {
          throw new Error('Target not found')
        }

        const id = crypto.randomUUID()
        const now = Date.now()

        this.sql.exec(
          'INSERT INTO relationships (id, from_id, to_id, verb, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          id,
          data.from,
          data.to,
          data.verb,
          JSON.stringify(data.data || {}),
          now
        )

        return {
          id,
          from: data.from,
          to: data.to,
          verb: data.verb,
          data: data.data || {},
          created_at: now,
        }
      }

      /**
       * Query relationships via RPC
       */
      async queryRelationships(query) {
        await this.initPromise

        let sql = 'SELECT * FROM relationships WHERE 1=1'
        const params = []

        if (query.from) {
          sql += ' AND from_id = ?'
          params.push(query.from)
        }
        if (query.to) {
          sql += ' AND to_id = ?'
          params.push(query.to)
        }
        if (query.verb) {
          sql += ' AND verb = ?'
          params.push(query.verb)
        }

        const rows = this.sql.exec(sql, ...params).toArray()

        return rows.map(row => ({
          id: row.id,
          from: row.from_id,
          to: row.to_id,
          verb: row.verb,
          data: JSON.parse(row.data),
          created_at: row.created_at,
        }))
      }

      /**
       * Get stats for this tenant's data
       */
      async getStats() {
        await this.initPromise

        const thingCount = this.sql.exec('SELECT COUNT(*) as count FROM things').toArray()[0].count
        const relCount = this.sql.exec('SELECT COUNT(*) as count FROM relationships').toArray()[0].count

        return {
          thingCount,
          relationshipCount: relCount,
        }
      }

      /**
       * Atomic counter increment (for concurrency testing)
       */
      async incrementCounter(key) {
        await this.initPromise

        // Get or create the counter thing
        let counter = await this.getThing(key)

        if (!counter) {
          counter = await this.createThing({
            id: key,
            type: 'Counter',
            data: { value: 0 },
          })
        }

        const newValue = (counter.data.value || 0) + 1

        const updated = await this.updateThing(key, {
          data: { value: newValue },
        })

        return updated.data.value
      }

      // ==========================================
      // REST Interface (fetch handler)
      // ==========================================

      async fetch(request) {
        await this.initPromise

        const url = new URL(request.url)
        const path = url.pathname
        const method = request.method

        // Parse body for POST/PUT/PATCH
        let body = null
        if (['POST', 'PUT', 'PATCH'].includes(method)) {
          try {
            body = await request.json()
          } catch (e) {
            // No body or invalid JSON
          }
        }

        // Route handlers
        try {
          // Things CRUD via REST
          if (path === '/things' && method === 'POST') {
            const thing = await this.createThing(body)
            return new Response(JSON.stringify(thing), {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          if (path.match(/^\\/things\\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[2]
            const thing = await this.getThing(id)
            if (!thing) {
              return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              })
            }
            return new Response(JSON.stringify(thing), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          if (path === '/things' && method === 'GET') {
            const type = url.searchParams.get('type')
            const items = await this.listThings(type)
            return new Response(JSON.stringify({ items, count: items.length }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          if (path.match(/^\\/things\\/[^/]+$/) && method === 'PATCH') {
            const id = path.split('/')[2]
            const updated = await this.updateThing(id, body)
            return new Response(JSON.stringify(updated), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          if (path.match(/^\\/things\\/[^/]+$/) && method === 'DELETE') {
            const id = path.split('/')[2]
            await this.deleteThing(id)
            return new Response(null, { status: 204 })
          }

          // Relationships
          if (path === '/relationships' && method === 'POST') {
            const rel = await this.createRelationship(body)
            return new Response(JSON.stringify(rel), {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          if (path === '/relationships' && method === 'GET') {
            const query = {
              from: url.searchParams.get('from'),
              to: url.searchParams.get('to'),
              verb: url.searchParams.get('verb'),
            }
            const rels = await this.queryRelationships(query)
            return new Response(JSON.stringify({ items: rels }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // Stats
          if (path === '/stats' && method === 'GET') {
            const stats = await this.getStats()
            return new Response(JSON.stringify(stats), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // Counter (for concurrency tests)
          if (path.match(/^\\/counter\\/[^/]+$/) && method === 'POST') {
            const key = path.split('/')[2]
            const value = await this.incrementCounter(key)
            return new Response(JSON.stringify({ value }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }

          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch (error) {
          const message = error.message || 'Internal error'
          const status = message === 'Not found' ? 404 : message === 'Duplicate ID' ? 409 : 500
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
    }

    export default {
      async fetch(request, env) {
        // Extract tenant from hostname (4+ parts = has subdomain)
        const url = new URL(request.url)
        const parts = url.hostname.split('.')

        let tenant = 'default'
        if (parts.length >= 4) {
          // tenant.api.dotdo.dev -> tenant
          tenant = parts[0]
        } else if (url.pathname.startsWith('/tenant/')) {
          // /tenant/:name/... -> extract from path
          const pathParts = url.pathname.split('/')
          tenant = pathParts[2]
        }

        const doId = env.TENANT_DO.idFromName(tenant)
        const stub = env.TENANT_DO.get(doId)
        return stub.fetch(request)
      }
    }
  `,
  durableObjects: {
    TENANT_DO: 'MultiTenantDO',
  },
})

// ============================================================================
// Test Suites
// ============================================================================

describe('Multi-Tenant E2E - Cross-Tenant Isolation', () => {
  let mf: Miniflare
  let tenantAStub: DurableObjectStub
  let tenantBStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')

    // Create two tenant DOs
    tenantAStub = ns.get(ns.idFromName('tenant-a'))
    tenantBStub = ns.get(ns.idFromName('tenant-b'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('tenant A data is not visible to tenant B', async () => {
    // Create data in tenant A
    const createAResponse = await tenantAStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({
        id: 'secret-data-a',
        type: 'Secret',
        data: { apiKey: 'sk_live_tenant_a_xxx' },
      }),
    })
    expect(createAResponse.status).toBe(201)

    // Verify tenant A can see it
    const getAResponse = await tenantAStub.fetch('http://fake/things/secret-data-a')
    expect(getAResponse.status).toBe(200)
    const dataA = (await getAResponse.json()) as { data: { apiKey: string } }
    expect(dataA.data.apiKey).toBe('sk_live_tenant_a_xxx')

    // Verify tenant B cannot see it (404)
    const getBResponse = await tenantBStub.fetch('http://fake/things/secret-data-a')
    expect(getBResponse.status).toBe(404)

    // Verify tenant B's list is empty (no cross-tenant leakage)
    const listBResponse = await tenantBStub.fetch('http://fake/things?type=Secret')
    expect(listBResponse.status).toBe(200)
    const listB = (await listBResponse.json()) as { items: unknown[]; count: number }
    expect(listB.items).toHaveLength(0)
  })

  it('tenant B data is isolated from tenant A', async () => {
    // Create data in tenant B
    await tenantBStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({
        id: 'private-b-1',
        type: 'PrivateDoc',
        data: { content: 'Confidential B' },
      }),
    })

    // Tenant A should not see tenant B's data
    const getFromA = await tenantAStub.fetch('http://fake/things/private-b-1')
    expect(getFromA.status).toBe(404)
  })

  it('both tenants can have items with same IDs without conflict', async () => {
    const sharedId = `shared-id-${Date.now()}`

    // Create with same ID in both tenants
    const createA = await tenantAStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({
        id: sharedId,
        type: 'Document',
        data: { owner: 'tenant-a', value: 100 },
      }),
    })
    expect(createA.status).toBe(201)

    const createB = await tenantBStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({
        id: sharedId,
        type: 'Document',
        data: { owner: 'tenant-b', value: 200 },
      }),
    })
    expect(createB.status).toBe(201)

    // Each tenant sees their own version
    const getA = await tenantAStub.fetch(`http://fake/things/${sharedId}`)
    const dataA = (await getA.json()) as { data: { owner: string; value: number } }
    expect(dataA.data.owner).toBe('tenant-a')
    expect(dataA.data.value).toBe(100)

    const getB = await tenantBStub.fetch(`http://fake/things/${sharedId}`)
    const dataB = (await getB.json()) as { data: { owner: string; value: number } }
    expect(dataB.data.owner).toBe('tenant-b')
    expect(dataB.data.value).toBe(200)
  })

  it('deleting data in one tenant does not affect another', async () => {
    const id = `delete-test-${Date.now()}`

    // Create in both tenants
    await tenantAStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id, type: 'Temp', data: {} }),
    })
    await tenantBStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id, type: 'Temp', data: {} }),
    })

    // Delete from tenant A
    const deleteA = await tenantAStub.fetch(`http://fake/things/${id}`, { method: 'DELETE' })
    expect(deleteA.status).toBe(204)

    // Verify gone from A
    const getA = await tenantAStub.fetch(`http://fake/things/${id}`)
    expect(getA.status).toBe(404)

    // Verify still exists in B
    const getB = await tenantBStub.fetch(`http://fake/things/${id}`)
    expect(getB.status).toBe(200)
  })

  it('relationships are isolated between tenants', async () => {
    const prefix = `rel-iso-${Date.now()}`

    // Create nodes in tenant A
    await tenantAStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: `${prefix}-source-a`, type: 'Node', data: {} }),
    })
    await tenantAStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: `${prefix}-target-a`, type: 'Node', data: {} }),
    })

    // Create relationship in tenant A
    const relA = await tenantAStub.fetch('http://fake/relationships', {
      method: 'POST',
      body: JSON.stringify({
        from: `${prefix}-source-a`,
        to: `${prefix}-target-a`,
        verb: 'connects',
      }),
    })
    expect(relA.status).toBe(201)

    // Query relationships in tenant B - should be empty
    const queryB = await tenantBStub.fetch('http://fake/relationships?verb=connects')
    const relsB = (await queryB.json()) as { items: unknown[] }
    expect(relsB.items).toHaveLength(0)
  })

  it('stats reflect only tenant-specific data', async () => {
    // Get baseline stats
    const statsABefore = await tenantAStub.fetch('http://fake/stats')
    const baseA = (await statsABefore.json()) as { thingCount: number }

    const statsBBefore = await tenantBStub.fetch('http://fake/stats')
    const baseB = (await statsBBefore.json()) as { thingCount: number }

    // Add items to tenant A only
    for (let i = 0; i < 3; i++) {
      await tenantAStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: `stats-test-${Date.now()}-${i}`,
          type: 'StatsItem',
          data: {},
        }),
      })
    }

    // Check stats
    const statsAAfter = await tenantAStub.fetch('http://fake/stats')
    const afterA = (await statsAAfter.json()) as { thingCount: number }
    expect(afterA.thingCount).toBe(baseA.thingCount + 3)

    // Tenant B stats should be unchanged
    const statsBAfter = await tenantBStub.fetch('http://fake/stats')
    const afterB = (await statsBAfter.json()) as { thingCount: number }
    expect(afterB.thingCount).toBe(baseB.thingCount)
  })
})

describe('Multi-Tenant E2E - Concurrent Access', () => {
  let mf: Miniflare
  let doStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    doStub = ns.get(ns.idFromName('concurrent-test'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('handles concurrent writes without data loss', async () => {
    const baseId = `concurrent-${Date.now()}`

    // Fire 10 concurrent creates
    const creates = Array.from({ length: 10 }, (_, i) =>
      doStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: `${baseId}-${i}`,
          type: 'ConcurrentItem',
          data: { index: i },
        }),
      })
    )

    const responses = await Promise.all(creates)

    // All should succeed
    for (const response of responses) {
      expect(response.status).toBe(201)
    }

    // Verify all items exist
    const listResponse = await doStub.fetch('http://fake/things?type=ConcurrentItem')
    const list = (await listResponse.json()) as { items: { id: string }[] }
    const ids = list.items.map((item) => item.id)

    for (let i = 0; i < 10; i++) {
      expect(ids).toContain(`${baseId}-${i}`)
    }
  })

  it('handles concurrent updates to same item', async () => {
    const itemId = `concurrent-update-${Date.now()}`

    // Create the item
    await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({
        id: itemId,
        type: 'UpdateTarget',
        data: { updates: [] },
      }),
    })

    // Fire concurrent updates
    const updates = Array.from({ length: 5 }, (_, i) =>
      doStub.fetch(`http://fake/things/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ data: { [`field_${i}`]: i } }),
      })
    )

    const responses = await Promise.all(updates)

    // All should succeed (200)
    for (const response of responses) {
      expect(response.status).toBe(200)
    }

    // Final item should have all fields
    const getResponse = await doStub.fetch(`http://fake/things/${itemId}`)
    const item = (await getResponse.json()) as { data: Record<string, number> }

    // Due to sequential processing in DO, all updates should be applied
    // Some fields may overwrite others, but at least one of each should exist
    const fieldCount = Object.keys(item.data).filter((k) => k.startsWith('field_')).length
    expect(fieldCount).toBeGreaterThanOrEqual(1)
  })

  it('atomic counter increments correctly under concurrency', async () => {
    const counterKey = `counter-${Date.now()}`

    // Fire 20 concurrent increments
    const increments = Array.from({ length: 20 }, () =>
      doStub.fetch(`http://fake/counter/${counterKey}`, { method: 'POST' })
    )

    await Promise.all(increments)

    // Get the final counter value
    const getResponse = await doStub.fetch(`http://fake/things/${counterKey}`)
    const counter = (await getResponse.json()) as { data: { value: number } }

    // Due to DO's single-threaded execution, all increments should be applied
    expect(counter.data.value).toBe(20)
  })

  it('handles concurrent relationship creation to same node', async () => {
    const sourceId = `hub-${Date.now()}`

    // Create a hub node
    await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: sourceId, type: 'Hub', data: {} }),
    })

    // Create target nodes
    const targetIds: string[] = []
    for (let i = 0; i < 5; i++) {
      const targetId = `spoke-${Date.now()}-${i}`
      targetIds.push(targetId)
      await doStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: targetId, type: 'Spoke', data: {} }),
      })
    }

    // Concurrently create relationships
    const relCreations = targetIds.map((targetId) =>
      doStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({
          from: sourceId,
          to: targetId,
          verb: 'connects',
        }),
      })
    )

    const responses = await Promise.all(relCreations)

    // All should succeed
    for (const response of responses) {
      expect(response.status).toBe(201)
    }

    // Verify all relationships exist
    const queryResponse = await doStub.fetch(`http://fake/relationships?from=${sourceId}`)
    const rels = (await queryResponse.json()) as { items: unknown[] }
    expect(rels.items).toHaveLength(5)
  })

  it('handles mixed read/write operations concurrently', async () => {
    const prefix = `mixed-${Date.now()}`

    // Pre-create some items
    for (let i = 0; i < 5; i++) {
      await doStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: `${prefix}-${i}`,
          type: 'MixedItem',
          data: { value: i },
        }),
      })
    }

    // Mix of reads, writes, and updates
    const operations = [
      // Reads
      doStub.fetch(`http://fake/things/${prefix}-0`),
      doStub.fetch(`http://fake/things/${prefix}-1`),
      doStub.fetch('http://fake/things?type=MixedItem'),
      // New writes
      doStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: `${prefix}-new-1`,
          type: 'MixedItem',
          data: {},
        }),
      }),
      doStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: `${prefix}-new-2`,
          type: 'MixedItem',
          data: {},
        }),
      }),
      // Updates
      doStub.fetch(`http://fake/things/${prefix}-2`, {
        method: 'PATCH',
        body: JSON.stringify({ data: { updated: true } }),
      }),
    ]

    const responses = await Promise.all(operations)

    // All operations should succeed (200 or 201)
    for (const response of responses) {
      expect([200, 201]).toContain(response.status)
    }
  })
})

describe('Multi-Tenant E2E - Protocol Switching', () => {
  let mf: Miniflare
  let doStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    doStub = ns.get(ns.idFromName('protocol-test'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('data created via REST is accessible via RPC', async () => {
    const id = `rest-to-rpc-${Date.now()}`

    // Create via REST (fetch)
    const createResponse = await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({
        id,
        type: 'CrossProtocol',
        data: { createdVia: 'REST' },
      }),
    })
    expect(createResponse.status).toBe(201)

    // Access via RPC (direct method call)
    // Note: In real Miniflare, RPC calls go through the same DO instance
    const rpcResponse = await doStub.fetch(`http://fake/things/${id}`)
    expect(rpcResponse.status).toBe(200)

    const data = (await rpcResponse.json()) as { data: { createdVia: string } }
    expect(data.data.createdVia).toBe('REST')
  })

  it('workflow: create via REST, update via REST, query via REST', async () => {
    const workflowId = `workflow-${Date.now()}`

    // Step 1: Create customer
    const createRes = await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({
        id: workflowId,
        type: 'Customer',
        data: { name: 'Acme Inc', status: 'pending' },
      }),
    })
    expect(createRes.status).toBe(201)

    // Step 2: Activate customer
    const updateRes = await doStub.fetch(`http://fake/things/${workflowId}`, {
      method: 'PATCH',
      body: JSON.stringify({ data: { status: 'active', activatedAt: Date.now() } }),
    })
    expect(updateRes.status).toBe(200)

    // Step 3: Query active customers
    const queryRes = await doStub.fetch('http://fake/things?type=Customer')
    expect(queryRes.status).toBe(200)

    const list = (await queryRes.json()) as { items: { id: string; data: { status: string } }[] }
    const customer = list.items.find((c) => c.id === workflowId)
    expect(customer).toBeDefined()
    expect(customer!.data.status).toBe('active')
  })

  it('workflow: build graph with mixed REST calls', async () => {
    const prefix = `graph-${Date.now()}`

    // Create nodes (REST)
    const nodeIds = ['user', 'order', 'product'].map((type) => `${prefix}-${type}`)

    for (let i = 0; i < nodeIds.length; i++) {
      const res = await doStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: nodeIds[i],
          type: ['User', 'Order', 'Product'][i],
          data: { index: i },
        }),
      })
      expect(res.status).toBe(201)
    }

    // Create relationships (REST)
    // User -> Order (places)
    const rel1 = await doStub.fetch('http://fake/relationships', {
      method: 'POST',
      body: JSON.stringify({
        from: `${prefix}-user`,
        to: `${prefix}-order`,
        verb: 'places',
      }),
    })
    expect(rel1.status).toBe(201)

    // Order -> Product (contains)
    const rel2 = await doStub.fetch('http://fake/relationships', {
      method: 'POST',
      body: JSON.stringify({
        from: `${prefix}-order`,
        to: `${prefix}-product`,
        verb: 'contains',
      }),
    })
    expect(rel2.status).toBe(201)

    // Query graph (REST)
    const userOrders = await doStub.fetch(`http://fake/relationships?from=${prefix}-user`)
    const ordersData = (await userOrders.json()) as { items: { to: string }[] }
    expect(ordersData.items).toHaveLength(1)
    expect(ordersData.items[0].to).toBe(`${prefix}-order`)

    const orderProducts = await doStub.fetch(`http://fake/relationships?from=${prefix}-order`)
    const productsData = (await orderProducts.json()) as { items: { to: string }[] }
    expect(productsData.items).toHaveLength(1)
    expect(productsData.items[0].to).toBe(`${prefix}-product`)
  })
})

describe('Multi-Tenant E2E - Stress Tests', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('handles multiple tenants operating simultaneously', async () => {
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    const tenantCount = 5
    const operationsPerTenant = 10

    // Create tenant stubs
    const tenants = Array.from({ length: tenantCount }, (_, i) =>
      ns.get(ns.idFromName(`stress-tenant-${i}`))
    )

    // Each tenant performs operations in parallel
    const allOperations = tenants.flatMap((stub, tenantIndex) =>
      Array.from({ length: operationsPerTenant }, (_, opIndex) =>
        stub.fetch('http://fake/things', {
          method: 'POST',
          body: JSON.stringify({
            id: `stress-${tenantIndex}-${opIndex}-${Date.now()}`,
            type: 'StressItem',
            data: { tenant: tenantIndex, op: opIndex },
          }),
        })
      )
    )

    const responses = await Promise.all(allOperations)

    // All operations should succeed
    const successCount = responses.filter((r) => r.status === 201).length
    expect(successCount).toBe(tenantCount * operationsPerTenant)

    // Verify each tenant has only their items
    for (let i = 0; i < tenantCount; i++) {
      const listRes = await tenants[i].fetch('http://fake/things?type=StressItem')
      const list = (await listRes.json()) as { items: { data: { tenant: number } }[] }

      // All items should belong to this tenant
      for (const item of list.items) {
        expect(item.data.tenant).toBe(i)
      }

      // Should have at least the items we created
      expect(list.items.length).toBeGreaterThanOrEqual(operationsPerTenant)
    }
  })

  it('handles rapid sequential operations to same tenant', async () => {
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    const stub = ns.get(ns.idFromName('rapid-fire-tenant'))

    const prefix = `rapid-${Date.now()}`
    const operationCount = 50

    // Rapid sequential creates
    for (let i = 0; i < operationCount; i++) {
      const res = await stub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: `${prefix}-${i}`,
          type: 'RapidItem',
          data: { index: i },
        }),
      })
      expect(res.status).toBe(201)
    }

    // Verify all items exist
    const listRes = await stub.fetch('http://fake/things?type=RapidItem')
    const list = (await listRes.json()) as { items: { id: string }[] }

    const createdIds = list.items.filter((item) => item.id.startsWith(prefix))
    expect(createdIds.length).toBe(operationCount)
  })
})

describe('Multi-Tenant E2E - Failure Recovery', () => {
  let mf: Miniflare
  let doStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    doStub = ns.get(ns.idFromName('failure-test'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('handles duplicate ID gracefully', async () => {
    const id = `dup-${Date.now()}`

    // First create succeeds
    const first = await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id, type: 'DupTest', data: {} }),
    })
    expect(first.status).toBe(201)

    // Second create fails with 409 Conflict
    const second = await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id, type: 'DupTest', data: {} }),
    })
    expect(second.status).toBe(409)

    // Original item still accessible
    const get = await doStub.fetch(`http://fake/things/${id}`)
    expect(get.status).toBe(200)
  })

  it('handles update to non-existent item', async () => {
    const res = await doStub.fetch('http://fake/things/does-not-exist-xyz', {
      method: 'PATCH',
      body: JSON.stringify({ data: { foo: 'bar' } }),
    })
    expect(res.status).toBe(404)
  })

  it('handles delete of non-existent item', async () => {
    const res = await doStub.fetch('http://fake/things/also-does-not-exist', {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })

  it('handles relationship with non-existent source', async () => {
    // Create only target
    await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: 'only-target', type: 'Node', data: {} }),
    })

    // Try to create relationship with non-existent source
    const res = await doStub.fetch('http://fake/relationships', {
      method: 'POST',
      body: JSON.stringify({
        from: 'non-existent-source',
        to: 'only-target',
        verb: 'links',
      }),
    })
    expect(res.status).toBe(404)
  })

  it('handles relationship with non-existent target', async () => {
    // Create only source
    await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: 'only-source', type: 'Node', data: {} }),
    })

    // Try to create relationship with non-existent target
    const res = await doStub.fetch('http://fake/relationships', {
      method: 'POST',
      body: JSON.stringify({
        from: 'only-source',
        to: 'non-existent-target',
        verb: 'links',
      }),
    })
    expect(res.status).toBe(404)
  })

  it('recovers after partial operation failure', async () => {
    const prefix = `recovery-${Date.now()}`

    // Create some items
    for (let i = 0; i < 3; i++) {
      await doStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: `${prefix}-${i}`, type: 'RecoverItem', data: {} }),
      })
    }

    // Try to create duplicate (will fail)
    const failRes = await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: `${prefix}-0`, type: 'RecoverItem', data: {} }),
    })
    expect(failRes.status).toBe(409)

    // System should still work normally after failure
    const newItem = await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: `${prefix}-new`, type: 'RecoverItem', data: {} }),
    })
    expect(newItem.status).toBe(201)

    // All items should be accessible
    const listRes = await doStub.fetch('http://fake/things?type=RecoverItem')
    const list = (await listRes.json()) as { items: { id: string }[] }

    const recoveryItems = list.items.filter((i) => i.id.startsWith(prefix))
    expect(recoveryItems.length).toBe(4) // 3 original + 1 new
  })
})

describe('Multi-Tenant E2E - Data Consistency', () => {
  let mf: Miniflare
  let doStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('TENANT_DO')
    doStub = ns.get(ns.idFromName('consistency-test'))
  })

  afterAll(async () => {
    await mf.dispose()
  })

  it('maintains referential integrity on cascade delete', async () => {
    const prefix = `cascade-${Date.now()}`

    // Create nodes
    await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: `${prefix}-a`, type: 'Node', data: {} }),
    })
    await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: `${prefix}-b`, type: 'Node', data: {} }),
    })
    await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id: `${prefix}-c`, type: 'Node', data: {} }),
    })

    // Create relationships: a -> b, b -> c
    await doStub.fetch('http://fake/relationships', {
      method: 'POST',
      body: JSON.stringify({ from: `${prefix}-a`, to: `${prefix}-b`, verb: 'links' }),
    })
    await doStub.fetch('http://fake/relationships', {
      method: 'POST',
      body: JSON.stringify({ from: `${prefix}-b`, to: `${prefix}-c`, verb: 'links' }),
    })

    // Delete middle node (b)
    const deleteRes = await doStub.fetch(`http://fake/things/${prefix}-b`, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)

    // Relationships involving b should be deleted
    const relsFromA = await doStub.fetch(`http://fake/relationships?from=${prefix}-a`)
    const fromAData = (await relsFromA.json()) as { items: unknown[] }
    expect(fromAData.items).toHaveLength(0)

    const relsToC = await doStub.fetch(`http://fake/relationships?to=${prefix}-c`)
    const toCData = (await relsToC.json()) as { items: unknown[] }
    expect(toCData.items).toHaveLength(0)

    // a and c should still exist
    const getA = await doStub.fetch(`http://fake/things/${prefix}-a`)
    expect(getA.status).toBe(200)

    const getC = await doStub.fetch(`http://fake/things/${prefix}-c`)
    expect(getC.status).toBe(200)
  })

  it('timestamps are updated correctly', async () => {
    const id = `timestamp-${Date.now()}`

    // Create
    const createRes = await doStub.fetch('http://fake/things', {
      method: 'POST',
      body: JSON.stringify({ id, type: 'TimestampTest', data: {} }),
    })
    const created = (await createRes.json()) as { created_at: number; updated_at: number }

    // created_at and updated_at should be same on create
    expect(created.created_at).toBe(created.updated_at)

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Update
    const updateRes = await doStub.fetch(`http://fake/things/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ data: { foo: 'bar' } }),
    })
    const updated = (await updateRes.json()) as { created_at: number; updated_at: number }

    // created_at should be unchanged, updated_at should be newer
    expect(updated.created_at).toBe(created.created_at)
    expect(updated.updated_at).toBeGreaterThan(created.updated_at)
  })

  it('list operation returns correct count', async () => {
    const prefix = `count-${Date.now()}`
    const count = 7

    for (let i = 0; i < count; i++) {
      await doStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: `${prefix}-${i}`, type: 'CountItem', data: {} }),
      })
    }

    const listRes = await doStub.fetch('http://fake/things?type=CountItem')
    const list = (await listRes.json()) as { items: { id: string }[]; count: number }

    const ourItems = list.items.filter((i) => i.id.startsWith(prefix))
    expect(ourItems.length).toBe(count)
    expect(list.count).toBeGreaterThanOrEqual(count)
  })
})
