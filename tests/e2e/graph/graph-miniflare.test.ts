/**
 * E2E Tests: Graph Operations with Real Miniflare DOs
 *
 * Unlike the Playwright-based HTTP tests, these tests use Miniflare
 * directly to test Durable Object graph operations. This allows:
 *
 * - Direct DO instantiation and method calls
 * - Testing DO persistence across restarts
 * - Testing DO-to-DO RPC calls
 * - Testing alarm/timer behavior
 * - More granular error testing
 *
 * These tests run with Vitest + Miniflare (not Playwright).
 *
 * @module tests/e2e/graph/graph-miniflare.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare, DurableObjectNamespace, DurableObjectStub } from 'miniflare'

/**
 * Miniflare configuration for graph tests
 */
const getMiniflareConfig = () => ({
  modules: true,
  script: `
    export class GraphDO {
      constructor(state, env) {
        this.state = state
        this.storage = state.storage
      }

      async fetch(request) {
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
        if (path === '/things' && method === 'POST') {
          return this.createThing(body)
        }
        if (path.startsWith('/things/') && method === 'GET') {
          const id = path.split('/')[2]
          return this.getThing(id)
        }
        if (path === '/things' && method === 'GET') {
          const type = url.searchParams.get('type')
          return this.listThings(type)
        }
        if (path.startsWith('/things/') && method === 'PATCH') {
          const id = path.split('/')[2]
          return this.updateThing(id, body)
        }
        if (path.startsWith('/things/') && method === 'DELETE') {
          const id = path.split('/')[2]
          return this.deleteThing(id)
        }

        if (path === '/relationships' && method === 'POST') {
          return this.createRelationship(body)
        }
        if (path.startsWith('/relationships/') && method === 'GET') {
          const id = path.split('/')[2]
          return this.getRelationship(id)
        }
        if (path === '/relationships' && method === 'GET') {
          const from = url.searchParams.get('from')
          const to = url.searchParams.get('to')
          const verb = url.searchParams.get('verb')
          return this.queryRelationships({ from, to, verb })
        }
        if (path.startsWith('/relationships/') && method === 'DELETE') {
          const id = path.split('/')[2]
          return this.deleteRelationship(id)
        }

        if (path === '/traverse' && method === 'GET') {
          const start = url.searchParams.get('start')
          const direction = url.searchParams.get('direction') || 'outgoing'
          const maxDepth = parseInt(url.searchParams.get('maxDepth') || '2')
          return this.traverse(start, direction, maxDepth)
        }

        if (path === '/stats' && method === 'GET') {
          return this.getStats()
        }

        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
      }

      async createThing(data) {
        if (!data || !data.type) {
          return new Response(JSON.stringify({ error: 'Missing type' }), { status: 400 })
        }

        const id = data.id || crypto.randomUUID()
        const existing = await this.storage.get(\`thing:\${id}\`)
        if (existing) {
          return new Response(JSON.stringify({ error: 'Duplicate ID' }), { status: 409 })
        }

        const thing = {
          id,
          type: data.type,
          data: data.data || {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        await this.storage.put(\`thing:\${id}\`, thing)
        await this.storage.put(\`thing-type:\${data.type}:\${id}\`, id)

        return new Response(JSON.stringify(thing), { status: 201 })
      }

      async getThing(id) {
        const thing = await this.storage.get(\`thing:\${id}\`)
        if (!thing) {
          return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
        }
        return new Response(JSON.stringify(thing))
      }

      async listThings(type) {
        const prefix = type ? \`thing-type:\${type}:\` : 'thing:'
        const list = await this.storage.list({ prefix })

        const items = []
        for (const [key, value] of list) {
          if (type) {
            const thing = await this.storage.get(\`thing:\${value}\`)
            if (thing) items.push(thing)
          } else {
            items.push(value)
          }
        }

        return new Response(JSON.stringify({ items, count: items.length }))
      }

      async updateThing(id, data) {
        const thing = await this.storage.get(\`thing:\${id}\`)
        if (!thing) {
          return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
        }

        const updated = {
          ...thing,
          data: { ...thing.data, ...data?.data },
          updatedAt: Date.now(),
        }

        await this.storage.put(\`thing:\${id}\`, updated)
        return new Response(JSON.stringify(updated))
      }

      async deleteThing(id) {
        const thing = await this.storage.get(\`thing:\${id}\`)
        if (!thing) {
          return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
        }

        await this.storage.delete(\`thing:\${id}\`)
        await this.storage.delete(\`thing-type:\${thing.type}:\${id}\`)

        // Cascade delete relationships
        const rels = await this.storage.list({ prefix: 'relationship:' })
        for (const [key, rel] of rels) {
          if (rel.from === id || rel.to === id) {
            await this.storage.delete(key)
            await this.storage.delete(\`rel-from:\${rel.from}:\${rel.id}\`)
            await this.storage.delete(\`rel-to:\${rel.to}:\${rel.id}\`)
          }
        }

        return new Response(null, { status: 204 })
      }

      async createRelationship(data) {
        if (!data?.from || !data?.to || !data?.verb) {
          return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 })
        }

        const fromThing = await this.storage.get(\`thing:\${data.from}\`)
        if (!fromThing) {
          return new Response(JSON.stringify({ error: 'Source not found' }), { status: 404 })
        }

        const toThing = await this.storage.get(\`thing:\${data.to}\`)
        if (!toThing) {
          return new Response(JSON.stringify({ error: 'Target not found' }), { status: 404 })
        }

        const id = crypto.randomUUID()
        const rel = {
          id,
          from: data.from,
          to: data.to,
          verb: data.verb,
          data: data.data || {},
          createdAt: Date.now(),
        }

        await this.storage.put(\`relationship:\${id}\`, rel)
        await this.storage.put(\`rel-from:\${data.from}:\${id}\`, id)
        await this.storage.put(\`rel-to:\${data.to}:\${id}\`, id)
        await this.storage.put(\`rel-verb:\${data.verb}:\${id}\`, id)

        return new Response(JSON.stringify(rel), { status: 201 })
      }

      async getRelationship(id) {
        const rel = await this.storage.get(\`relationship:\${id}\`)
        if (!rel) {
          return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
        }
        return new Response(JSON.stringify(rel))
      }

      async queryRelationships({ from, to, verb }) {
        let prefix = 'relationship:'
        let filterKeys = new Set()

        if (from) {
          const list = await this.storage.list({ prefix: \`rel-from:\${from}:\` })
          for (const [_, id] of list) filterKeys.add(id)
        }
        if (to) {
          const list = await this.storage.list({ prefix: \`rel-to:\${to}:\` })
          const toKeys = new Set()
          for (const [_, id] of list) toKeys.add(id)

          if (filterKeys.size > 0) {
            filterKeys = new Set([...filterKeys].filter(k => toKeys.has(k)))
          } else {
            filterKeys = toKeys
          }
        }
        if (verb) {
          const list = await this.storage.list({ prefix: \`rel-verb:\${verb}:\` })
          const verbKeys = new Set()
          for (const [_, id] of list) verbKeys.add(id)

          if (filterKeys.size > 0) {
            filterKeys = new Set([...filterKeys].filter(k => verbKeys.has(k)))
          } else {
            filterKeys = verbKeys
          }
        }

        const items = []
        if (from || to || verb) {
          for (const id of filterKeys) {
            const rel = await this.storage.get(\`relationship:\${id}\`)
            if (rel) items.push(rel)
          }
        } else {
          const list = await this.storage.list({ prefix })
          for (const [_, rel] of list) {
            items.push(rel)
          }
        }

        return new Response(JSON.stringify({ items }))
      }

      async deleteRelationship(id) {
        const rel = await this.storage.get(\`relationship:\${id}\`)
        if (!rel) {
          return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
        }

        await this.storage.delete(\`relationship:\${id}\`)
        await this.storage.delete(\`rel-from:\${rel.from}:\${id}\`)
        await this.storage.delete(\`rel-to:\${rel.to}:\${id}\`)
        await this.storage.delete(\`rel-verb:\${rel.verb}:\${id}\`)

        return new Response(null, { status: 204 })
      }

      async traverse(startId, direction, maxDepth) {
        const startThing = await this.storage.get(\`thing:\${startId}\`)
        if (!startThing) {
          return new Response(JSON.stringify({ error: 'Start not found' }), { status: 404 })
        }

        const visited = new Set()
        const nodes = []
        const queue = [{ id: startId, depth: 0 }]

        while (queue.length > 0) {
          const { id, depth } = queue.shift()
          if (visited.has(id)) continue
          visited.add(id)

          if (depth > 0) {
            const thing = await this.storage.get(\`thing:\${id}\`)
            if (thing) nodes.push(thing)
          }

          if (depth >= maxDepth) continue

          // Get relationships based on direction
          const prefixes = []
          if (direction === 'outgoing' || direction === 'both') {
            prefixes.push(\`rel-from:\${id}:\`)
          }
          if (direction === 'incoming' || direction === 'both') {
            prefixes.push(\`rel-to:\${id}:\`)
          }

          for (const prefix of prefixes) {
            const list = await this.storage.list({ prefix })
            for (const [_, relId] of list) {
              const rel = await this.storage.get(\`relationship:\${relId}\`)
              if (!rel) continue

              const neighborId = rel.from === id ? rel.to : rel.from
              if (!visited.has(neighborId)) {
                queue.push({ id: neighborId, depth: depth + 1 })
              }
            }
          }
        }

        return new Response(JSON.stringify({ nodes }))
      }

      async getStats() {
        const things = await this.storage.list({ prefix: 'thing:' })
        const rels = await this.storage.list({ prefix: 'relationship:' })

        return new Response(JSON.stringify({
          thingCount: things.size,
          relationshipCount: rels.size,
        }))
      }
    }

    export default {
      async fetch(request, env) {
        const url = new URL(request.url)
        const doId = env.GRAPH.idFromName('test')
        const stub = env.GRAPH.get(doId)
        return stub.fetch(request)
      }
    }
  `,
  durableObjects: {
    GRAPH: 'GraphDO',
  },
})

describe('Graph E2E - Miniflare DO Tests', () => {
  let mf: Miniflare
  let graphStub: DurableObjectStub

  beforeAll(async () => {
    mf = new Miniflare(getMiniflareConfig())
    const ns = await mf.getDurableObjectNamespace('GRAPH')
    const id = ns.idFromName('test')
    graphStub = ns.get(id)
  })

  afterAll(async () => {
    await mf.dispose()
  })

  describe('Thing CRUD', () => {
    it('creates and retrieves a Thing', async () => {
      const thingId = `mf-test-${Date.now()}`

      // Create
      const createResponse = await graphStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: thingId,
          type: 'TestType',
          data: { name: 'Test Thing' },
        }),
      })

      expect(createResponse.status).toBe(201)
      const created = await createResponse.json() as { id: string; type: string; data: { name: string } }
      expect(created.id).toBe(thingId)
      expect(created.type).toBe('TestType')

      // Retrieve
      const getResponse = await graphStub.fetch(`http://fake/things/${thingId}`)
      expect(getResponse.status).toBe(200)
      const retrieved = await getResponse.json() as { id: string; type: string; data: { name: string } }
      expect(retrieved.id).toBe(thingId)
      expect(retrieved.data.name).toBe('Test Thing')
    })

    it('updates a Thing', async () => {
      const thingId = `mf-update-${Date.now()}`

      // Create
      await graphStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: thingId,
          type: 'UpdateTest',
          data: { version: 1 },
        }),
      })

      // Update
      const updateResponse = await graphStub.fetch(`http://fake/things/${thingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ data: { version: 2, updated: true } }),
      })

      expect(updateResponse.status).toBe(200)
      const updated = await updateResponse.json() as { data: { version: number; updated: boolean } }
      expect(updated.data.version).toBe(2)
      expect(updated.data.updated).toBe(true)
    })

    it('deletes a Thing', async () => {
      const thingId = `mf-delete-${Date.now()}`

      // Create
      await graphStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({
          id: thingId,
          type: 'DeleteTest',
          data: {},
        }),
      })

      // Delete
      const deleteResponse = await graphStub.fetch(`http://fake/things/${thingId}`, {
        method: 'DELETE',
      })
      expect(deleteResponse.status).toBe(204)

      // Verify gone
      const getResponse = await graphStub.fetch(`http://fake/things/${thingId}`)
      expect(getResponse.status).toBe(404)
    })

    it('lists Things by type', async () => {
      const prefix = `mf-list-${Date.now()}`

      // Create multiple
      for (let i = 0; i < 3; i++) {
        await graphStub.fetch('http://fake/things', {
          method: 'POST',
          body: JSON.stringify({
            id: `${prefix}-${i}`,
            type: 'ListType',
            data: { index: i },
          }),
        })
      }

      // List
      const listResponse = await graphStub.fetch('http://fake/things?type=ListType')
      expect(listResponse.status).toBe(200)
      const result = await listResponse.json() as { items: unknown[]; count: number }
      expect(result.items.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Relationship CRUD', () => {
    let sourceId: string
    let targetId: string

    beforeEach(async () => {
      sourceId = `mf-rel-source-${Date.now()}`
      targetId = `mf-rel-target-${Date.now()}`

      await graphStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: sourceId, type: 'Source', data: {} }),
      })
      await graphStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: targetId, type: 'Target', data: {} }),
      })
    })

    it('creates and retrieves a Relationship', async () => {
      const createResponse = await graphStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({
          from: sourceId,
          to: targetId,
          verb: 'connects',
          data: { weight: 0.5 },
        }),
      })

      expect(createResponse.status).toBe(201)
      const rel = await createResponse.json() as { id: string; from: string; to: string; verb: string; data: { weight: number } }
      expect(rel.from).toBe(sourceId)
      expect(rel.to).toBe(targetId)
      expect(rel.verb).toBe('connects')

      // Retrieve
      const getResponse = await graphStub.fetch(`http://fake/relationships/${rel.id}`)
      expect(getResponse.status).toBe(200)
    })

    it('queries relationships by from', async () => {
      await graphStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({ from: sourceId, to: targetId, verb: 'links' }),
      })

      const queryResponse = await graphStub.fetch(`http://fake/relationships?from=${sourceId}`)
      expect(queryResponse.status).toBe(200)
      const result = await queryResponse.json() as { items: { from: string; to: string }[] }
      expect(result.items.some((r) => r.from === sourceId && r.to === targetId)).toBe(true)
    })

    it('deletes relationship and cascade on Thing delete', async () => {
      const relResponse = await graphStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({ from: sourceId, to: targetId, verb: 'cascadeTest' }),
      })
      const rel = await relResponse.json() as { id: string }

      // Delete source Thing
      await graphStub.fetch(`http://fake/things/${sourceId}`, { method: 'DELETE' })

      // Relationship should be gone
      const relGetResponse = await graphStub.fetch(`http://fake/relationships/${rel.id}`)
      expect(relGetResponse.status).toBe(404)
    })
  })

  describe('Graph Traversal', () => {
    it('traverses a simple path', async () => {
      const prefix = `mf-traverse-${Date.now()}`
      const aId = `${prefix}-a`
      const bId = `${prefix}-b`
      const cId = `${prefix}-c`

      // Create A -> B -> C
      for (const id of [aId, bId, cId]) {
        await graphStub.fetch('http://fake/things', {
          method: 'POST',
          body: JSON.stringify({ id, type: 'Node', data: {} }),
        })
      }

      await graphStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({ from: aId, to: bId, verb: 'next' }),
      })
      await graphStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({ from: bId, to: cId, verb: 'next' }),
      })

      // Traverse from A
      const traverseResponse = await graphStub.fetch(
        `http://fake/traverse?start=${aId}&direction=outgoing&maxDepth=2`
      )
      expect(traverseResponse.status).toBe(200)
      const result = await traverseResponse.json() as { nodes: { id: string }[] }

      const nodeIds = result.nodes.map((n) => n.id)
      expect(nodeIds).toContain(bId)
      expect(nodeIds).toContain(cId)
    })

    it('handles bidirectional traversal', async () => {
      const prefix = `mf-bidir-${Date.now()}`
      const centerId = `${prefix}-center`
      const leftId = `${prefix}-left`
      const rightId = `${prefix}-right`

      for (const id of [centerId, leftId, rightId]) {
        await graphStub.fetch('http://fake/things', {
          method: 'POST',
          body: JSON.stringify({ id, type: 'Node', data: {} }),
        })
      }

      // left -> center -> right
      await graphStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({ from: leftId, to: centerId, verb: 'points' }),
      })
      await graphStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({ from: centerId, to: rightId, verb: 'points' }),
      })

      // Traverse both directions from center
      const traverseResponse = await graphStub.fetch(
        `http://fake/traverse?start=${centerId}&direction=both&maxDepth=1`
      )
      expect(traverseResponse.status).toBe(200)
      const result = await traverseResponse.json() as { nodes: { id: string }[] }

      const nodeIds = result.nodes.map((n) => n.id)
      expect(nodeIds).toContain(leftId)
      expect(nodeIds).toContain(rightId)
    })

    it('handles cycles without infinite loop', async () => {
      const prefix = `mf-cycle-${Date.now()}`
      const aId = `${prefix}-a`
      const bId = `${prefix}-b`

      for (const id of [aId, bId]) {
        await graphStub.fetch('http://fake/things', {
          method: 'POST',
          body: JSON.stringify({ id, type: 'Node', data: {} }),
        })
      }

      // A <-> B (cycle)
      await graphStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({ from: aId, to: bId, verb: 'links' }),
      })
      await graphStub.fetch('http://fake/relationships', {
        method: 'POST',
        body: JSON.stringify({ from: bId, to: aId, verb: 'links' }),
      })

      // Should complete without hanging
      const traverseResponse = await graphStub.fetch(
        `http://fake/traverse?start=${aId}&direction=outgoing&maxDepth=10`
      )
      expect(traverseResponse.status).toBe(200)
      const result = await traverseResponse.json() as { nodes: { id: string }[] }

      // Should visit B only once
      const bCount = result.nodes.filter((n) => n.id === bId).length
      expect(bCount).toBe(1)
    })
  })

  describe('Concurrent Operations', () => {
    it('handles concurrent writes to same Thing', async () => {
      const thingId = `mf-concurrent-${Date.now()}`

      await graphStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: thingId, type: 'ConcurrentTest', data: { counter: 0 } }),
      })

      // Fire concurrent updates
      const updates = Array.from({ length: 5 }, (_, i) =>
        graphStub.fetch(`http://fake/things/${thingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ data: { [`update_${i}`]: i } }),
        })
      )

      const responses = await Promise.all(updates)
      for (const response of responses) {
        expect(response.status).toBe(200)
      }

      // Final state should have all updates
      const finalResponse = await graphStub.fetch(`http://fake/things/${thingId}`)
      const final = await finalResponse.json() as { data: Record<string, number> }

      for (let i = 0; i < 5; i++) {
        expect(final.data[`update_${i}`]).toBe(i)
      }
    })

    it('handles concurrent relationship creation', async () => {
      const sourceId = `mf-concrel-${Date.now()}`
      await graphStub.fetch('http://fake/things', {
        method: 'POST',
        body: JSON.stringify({ id: sourceId, type: 'Source', data: {} }),
      })

      // Create targets
      const targetIds: string[] = []
      for (let i = 0; i < 5; i++) {
        const targetId = `${sourceId}-target-${i}`
        targetIds.push(targetId)
        await graphStub.fetch('http://fake/things', {
          method: 'POST',
          body: JSON.stringify({ id: targetId, type: 'Target', data: {} }),
        })
      }

      // Concurrent relationship creation
      const relCreations = targetIds.map((targetId, i) =>
        graphStub.fetch('http://fake/relationships', {
          method: 'POST',
          body: JSON.stringify({ from: sourceId, to: targetId, verb: 'connects', data: { index: i } }),
        })
      )

      const responses = await Promise.all(relCreations)
      for (const response of responses) {
        expect(response.status).toBe(201)
      }

      // Verify all relationships exist
      const queryResponse = await graphStub.fetch(`http://fake/relationships?from=${sourceId}`)
      const result = await queryResponse.json() as { items: unknown[] }
      expect(result.items.length).toBe(5)
    })
  })

  describe('Stats', () => {
    it('returns graph statistics', async () => {
      const statsResponse = await graphStub.fetch('http://fake/stats')
      expect(statsResponse.status).toBe(200)

      const stats = await statsResponse.json() as { thingCount: number; relationshipCount: number }
      expect(stats.thingCount).toBeDefined()
      expect(stats.relationshipCount).toBeDefined()
      expect(typeof stats.thingCount).toBe('number')
      expect(typeof stats.relationshipCount).toBe('number')
    })
  })
})
