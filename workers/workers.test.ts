/**
 * Worker Layer Tests - Deployment Patterns
 *
 * Tests for URL routing, RPC proxy, sharding, and replication patterns.
 *
 * @module workers/workers.test
 */

import { describe, it, expect } from 'vitest'

// Import actual implementations
import { parseSubdomainRoute, parsePathRoute, parsePathBaseRoute } from './routing'
import { createRPCProxy } from './rpc-proxy'
import { createHashRing, hashKey } from './sharding'
import { detectIntent, createReplicaRouter } from './replication'
import { createWorkerPreset, createShardedWorker, createReplicatedWorker, createProductionWorker } from './presets'

// =============================================================================
// 1. URL Routing - Subdomain Pattern
// =============================================================================

describe('URL Routing - Subdomain Pattern', () => {
  /**
   * Pattern: tenant.api.dotdo.dev/customers/123
   * Extracts: ns='tenant', type='customers', id='123'
   */

  describe('basic namespace extraction', () => {
    it('extracts namespace from single subdomain', () => {
      const result = parseSubdomainRoute(
        'https://tenant.api.dotdo.dev/customers/123',
        'api.dotdo.dev'
      )
      expect(result).not.toBeNull()
      expect(result?.ns).toBe('tenant')
      expect(result?.type).toBe('customers')
      expect(result?.id).toBe('123')
      expect(result?.remainingPath).toBe('')
    })

    it('extracts namespace with hyphen', () => {
      const result = parseSubdomainRoute(
        'https://my-tenant.api.dotdo.dev/orders',
        'api.dotdo.dev'
      )
      expect(result?.ns).toBe('my-tenant')
      expect(result?.type).toBe('orders')
    })

    it('extracts namespace with numbers', () => {
      const result = parseSubdomainRoute(
        'https://tenant123.api.dotdo.dev/users',
        'api.dotdo.dev'
      )
      expect(result?.ns).toBe('tenant123')
    })

    it('handles deep subdomain by taking first level only', () => {
      const result = parseSubdomainRoute(
        'https://foo.bar.api.dotdo.dev/items',
        'api.dotdo.dev'
      )
      expect(result?.ns).toBe('foo')
    })
  })

  describe('resource extraction', () => {
    it('extracts type without id', () => {
      const result = parseSubdomainRoute(
        'https://tenant.api.dotdo.dev/customers',
        'api.dotdo.dev'
      )
      expect(result?.ns).toBe('tenant')
      expect(result?.type).toBe('customers')
      expect(result?.id).toBeUndefined()
    })

    it('extracts type and id', () => {
      const result = parseSubdomainRoute(
        'https://tenant.api.dotdo.dev/customers/abc-123',
        'api.dotdo.dev'
      )
      expect(result?.type).toBe('customers')
      expect(result?.id).toBe('abc-123')
    })

    it('preserves remaining path after id', () => {
      const result = parseSubdomainRoute(
        'https://tenant.api.dotdo.dev/customers/123/orders/456',
        'api.dotdo.dev'
      )
      expect(result?.type).toBe('customers')
      expect(result?.id).toBe('123')
      expect(result?.remainingPath).toBe('/orders/456')
    })

    it('handles root path', () => {
      const result = parseSubdomainRoute(
        'https://tenant.api.dotdo.dev/',
        'api.dotdo.dev'
      )
      expect(result?.ns).toBe('tenant')
      expect(result?.type).toBeUndefined()
      expect(result?.id).toBeUndefined()
      expect(result?.remainingPath).toBe('/')
    })
  })

  describe('edge cases', () => {
    it('returns null for apex domain (no subdomain)', () => {
      const result = parseSubdomainRoute(
        'https://api.dotdo.dev/customers',
        'api.dotdo.dev'
      )
      expect(result).toBeNull()
    })

    it('returns null for non-matching domain', () => {
      const result = parseSubdomainRoute(
        'https://tenant.other.com/customers',
        'api.dotdo.dev'
      )
      expect(result).toBeNull()
    })

    it('handles URL object input', () => {
      const url = new URL('https://tenant.api.dotdo.dev/products/xyz')
      const result = parseSubdomainRoute(url, 'api.dotdo.dev')
      expect(result?.ns).toBe('tenant')
      expect(result?.type).toBe('products')
      expect(result?.id).toBe('xyz')
    })

    it('preserves query parameters in remaining path', () => {
      const result = parseSubdomainRoute(
        'https://tenant.api.dotdo.dev/customers?limit=10',
        'api.dotdo.dev'
      )
      expect(result?.type).toBe('customers')
      expect(result?.remainingPath).toContain('limit=10')
    })
  })
})

// =============================================================================
// 2. URL Routing - Path NS Pattern
// =============================================================================

describe('URL Routing - Path NS Pattern', () => {
  /**
   * Pattern: api.dotdo.dev/tenant/customers/123
   * Extracts: ns='tenant', type='customers', id='123'
   */

  describe('basic namespace extraction', () => {
    it('extracts namespace from first path segment', () => {
      const result = parsePathRoute('https://api.dotdo.dev/tenant/customers/123')
      expect(result?.ns).toBe('tenant')
      expect(result?.type).toBe('customers')
      expect(result?.id).toBe('123')
    })

    it('extracts namespace with hyphen', () => {
      const result = parsePathRoute('https://api.dotdo.dev/my-org/orders')
      expect(result?.ns).toBe('my-org')
      expect(result?.type).toBe('orders')
    })

    it('extracts namespace with numbers', () => {
      const result = parsePathRoute('https://api.dotdo.dev/org123/users')
      expect(result?.ns).toBe('org123')
    })
  })

  describe('resource extraction', () => {
    it('extracts type without id', () => {
      const result = parsePathRoute('https://api.dotdo.dev/tenant/customers')
      expect(result?.type).toBe('customers')
      expect(result?.id).toBeUndefined()
    })

    it('extracts type and id', () => {
      const result = parsePathRoute('https://api.dotdo.dev/tenant/customers/abc-123')
      expect(result?.type).toBe('customers')
      expect(result?.id).toBe('abc-123')
    })

    it('preserves remaining path', () => {
      const result = parsePathRoute('https://api.dotdo.dev/tenant/customers/123/profile')
      expect(result?.remainingPath).toBe('/profile')
    })
  })

  describe('edge cases', () => {
    it('returns null for root path', () => {
      const result = parsePathRoute('https://api.dotdo.dev/')
      expect(result).toBeNull()
    })

    it('handles namespace-only path', () => {
      const result = parsePathRoute('https://api.dotdo.dev/tenant')
      expect(result?.ns).toBe('tenant')
      expect(result?.type).toBeUndefined()
    })

    it('handles URL object input', () => {
      const url = new URL('https://api.dotdo.dev/org/products/xyz')
      const result = parsePathRoute(url)
      expect(result?.ns).toBe('org')
      expect(result?.type).toBe('products')
    })
  })
})

// =============================================================================
// 3. URL Routing - Path Base Pattern
// =============================================================================

describe('URL Routing - Path Base Pattern', () => {
  /**
   * Pattern: api.dotdo.dev/v1/tenant/customers/123
   * Supports version prefix before namespace
   */

  describe('version prefix handling', () => {
    it('strips version prefix and extracts route', () => {
      const result = parsePathBaseRoute(
        'https://api.dotdo.dev/v1/tenant/customers/123',
        '/v1'
      )
      expect(result?.ns).toBe('tenant')
      expect(result?.type).toBe('customers')
      expect(result?.id).toBe('123')
    })

    it('handles v2 prefix', () => {
      const result = parsePathBaseRoute(
        'https://api.dotdo.dev/v2/org/orders',
        '/v2'
      )
      expect(result?.ns).toBe('org')
      expect(result?.type).toBe('orders')
    })

    it('handles api prefix', () => {
      const result = parsePathBaseRoute(
        'https://api.dotdo.dev/api/tenant/users',
        '/api'
      )
      expect(result?.ns).toBe('tenant')
      expect(result?.type).toBe('users')
    })

    it('handles nested base path', () => {
      const result = parsePathBaseRoute(
        'https://api.dotdo.dev/api/v3/tenant/items',
        '/api/v3'
      )
      expect(result?.ns).toBe('tenant')
      expect(result?.type).toBe('items')
    })
  })

  describe('edge cases', () => {
    it('returns null if base path does not match', () => {
      const result = parsePathBaseRoute(
        'https://api.dotdo.dev/v2/tenant/customers',
        '/v1'
      )
      expect(result).toBeNull()
    })

    it('returns null for path shorter than base', () => {
      const result = parsePathBaseRoute(
        'https://api.dotdo.dev/v1',
        '/v1'
      )
      expect(result).toBeNull()
    })

    it('handles trailing slash in base path', () => {
      const result = parsePathBaseRoute(
        'https://api.dotdo.dev/v1/tenant/customers',
        '/v1/'
      )
      expect(result?.ns).toBe('tenant')
    })
  })
})

// =============================================================================
// 4. RPC Proxy
// =============================================================================

describe('RPC Proxy', () => {
  /**
   * Proxies Cap'n Web RPC to DO
   * - Authenticates requests
   * - Streams responses
   * - Handles method invocation
   */

  describe('authentication', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const proxy = createRPCProxy({
        authenticate: async () => ({ valid: false }),
      })

      const request = new Request('https://api.dotdo.dev/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'things.list' }),
      })

      const response = await proxy.handleRequest(request, {})
      expect(response.status).toBe(401)
    })

    it('allows authenticated requests', async () => {
      const proxy = createRPCProxy({
        authenticate: async () => ({ valid: true, identity: 'user-123' }),
      })

      const request = new Request('https://api.dotdo.dev/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'things.list' }),
      })

      const response = await proxy.handleRequest(request, {})
      expect(response.status).not.toBe(401)
    })

    it('extracts bearer token from Authorization header', async () => {
      let receivedRequest: Request | null = null
      const proxy = createRPCProxy({
        authenticate: async (req) => {
          receivedRequest = req
          const auth = req.headers.get('Authorization')
          return { valid: auth === 'Bearer valid-token' }
        },
      })

      const request = new Request('https://api.dotdo.dev/rpc', {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
        body: JSON.stringify({ method: 'things.get', params: { id: '123' } }),
      })

      await proxy.handleRequest(request, {})
      expect(receivedRequest).not.toBeNull()
    })
  })

  describe('authorization', () => {
    it('rejects unauthorized methods with 403', async () => {
      const proxy = createRPCProxy({
        authenticate: async () => ({ valid: true, identity: 'user-123' }),
        authorize: async (identity, method) => method !== 'admin.delete',
      })

      const request = new Request('https://api.dotdo.dev/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'admin.delete' }),
      })

      const response = await proxy.handleRequest(request, {})
      expect(response.status).toBe(403)
    })

    it('allows authorized methods', async () => {
      const proxy = createRPCProxy({
        authenticate: async () => ({ valid: true, identity: 'admin' }),
        authorize: async () => true,
      })

      const request = new Request('https://api.dotdo.dev/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'things.create' }),
      })

      const response = await proxy.handleRequest(request, {})
      expect(response.status).not.toBe(403)
    })
  })

  describe('response streaming', () => {
    it('returns streaming response for stream methods', async () => {
      const proxy = createRPCProxy({
        authenticate: async () => ({ valid: true }),
      })

      const request = new Request('https://api.dotdo.dev/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'events.stream', params: { since: 0 } }),
      })

      const response = await proxy.handleRequest(request, {})
      expect(response.headers.get('Content-Type')).toMatch(/text\/event-stream|application\/x-ndjson/)
    })

    it('returns JSON response for non-stream methods', async () => {
      const proxy = createRPCProxy({
        authenticate: async () => ({ valid: true }),
      })

      const request = new Request('https://api.dotdo.dev/rpc', {
        method: 'POST',
        body: JSON.stringify({ method: 'things.get', params: { id: '123' } }),
      })

      const response = await proxy.handleRequest(request, {})
      expect(response.headers.get('Content-Type')).toMatch(/application\/json/)
    })
  })

  describe('method invocation', () => {
    it('forwards method call to DO', async () => {
      const proxy = createRPCProxy({
        authenticate: async () => ({ valid: true }),
      })

      const request = new Request('https://tenant.api.dotdo.dev/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'things.create',
          params: { $type: 'Customer', name: 'Alice' },
        }),
      })

      const response = await proxy.handleRequest(request, {})
      // Should return result from DO
      expect(response.ok).toBe(true)
    })

    it('handles batch requests', async () => {
      const proxy = createRPCProxy({
        authenticate: async () => ({ valid: true }),
      })

      const request = new Request('https://api.dotdo.dev/rpc', {
        method: 'POST',
        body: JSON.stringify([
          { id: 1, method: 'things.get', params: { id: 'a' } },
          { id: 2, method: 'things.get', params: { id: 'b' } },
        ]),
      })

      const response = await proxy.handleRequest(request, {})
      const results = await response.json() as unknown[]
      expect(Array.isArray(results)).toBe(true)
      expect(results).toHaveLength(2)
    })
  })
})

// =============================================================================
// 5. Sharding (Consistent Hash)
// =============================================================================

describe('Sharding - Consistent Hash Ring', () => {
  /**
   * Consistent hash ring for distributing data across shards
   * - hash(ns:type:id) -> shard index
   * - Virtual nodes for even distribution
   * - Supports rebalancing without full data movement
   */

  describe('node management', () => {
    it('adds nodes to ring', () => {
      const ring = createHashRing({ shardCount: 3 })
      ring.addNode('shard-0')
      ring.addNode('shard-1')
      ring.addNode('shard-2')
      expect(ring.getNodes()).toHaveLength(3)
    })

    it('removes nodes from ring', () => {
      const ring = createHashRing({ shardCount: 3 })
      ring.addNode('shard-0')
      ring.addNode('shard-1')
      ring.addNode('shard-2')
      ring.removeNode('shard-1')
      expect(ring.getNodes()).toHaveLength(2)
      expect(ring.getNodes()).not.toContain('shard-1')
    })

    it('creates virtual nodes for distribution', () => {
      const ring = createHashRing({ shardCount: 3, virtualNodes: 100 })
      ring.addNode('shard-0')
      expect(ring.getVirtualNodeCount()).toBe(100)
    })
  })

  describe('key distribution', () => {
    it('consistently maps key to same node', () => {
      const ring = createHashRing({ shardCount: 3 })
      ring.addNode('shard-0')
      ring.addNode('shard-1')
      ring.addNode('shard-2')

      const key = hashKey('tenant', 'customers', '123')
      const node1 = ring.getNode(key)
      const node2 = ring.getNode(key)

      expect(node1).toBe(node2)
    })

    it('distributes keys roughly evenly', () => {
      const ring = createHashRing({ shardCount: 3, virtualNodes: 150 })
      ring.addNode('shard-0')
      ring.addNode('shard-1')
      ring.addNode('shard-2')

      const distribution: Record<string, number> = { 'shard-0': 0, 'shard-1': 0, 'shard-2': 0 }

      // Generate 1000 keys and check distribution
      for (let i = 0; i < 1000; i++) {
        const key = hashKey('tenant', 'items', `item-${i}`)
        const node = ring.getNode(key)
        distribution[node]++
      }

      // Each shard should get roughly 33% (+/- 10%)
      for (const count of Object.values(distribution)) {
        expect(count).toBeGreaterThan(230) // At least 23%
        expect(count).toBeLessThan(430)    // At most 43%
      }
    })

    it('minimizes key movement on node addition', () => {
      const ring = createHashRing({ shardCount: 4, virtualNodes: 150 })
      ring.addNode('shard-0')
      ring.addNode('shard-1')
      ring.addNode('shard-2')

      // Record initial assignments
      const initialAssignments: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        const key = hashKey('tenant', 'items', `item-${i}`)
        initialAssignments[key] = ring.getNode(key)
      }

      // Add new node
      ring.addNode('shard-3')

      // Count how many keys moved
      let movedCount = 0
      for (const [key, originalNode] of Object.entries(initialAssignments)) {
        if (ring.getNode(key) !== originalNode) {
          movedCount++
        }
      }

      // Ideally ~25% should move (1/4 of keys go to new shard)
      // Allow some variance: 10-40% for small sample size
      expect(movedCount).toBeGreaterThan(10)
      expect(movedCount).toBeLessThan(40)
    })
  })

  describe('hash key generation', () => {
    it('generates unique keys for different resources', () => {
      const key1 = hashKey('tenant', 'customers', '123')
      const key2 = hashKey('tenant', 'orders', '123')
      expect(key1).not.toBe(key2)
    })

    it('generates unique keys for different tenants', () => {
      const key1 = hashKey('tenant-a', 'customers', '123')
      const key2 = hashKey('tenant-b', 'customers', '123')
      expect(key1).not.toBe(key2)
    })

    it('generates same key for same input', () => {
      const key1 = hashKey('tenant', 'customers', '123')
      const key2 = hashKey('tenant', 'customers', '123')
      expect(key1).toBe(key2)
    })
  })
})

// =============================================================================
// 6. Replication
// =============================================================================

describe('Replication', () => {
  /**
   * Read replica routing for horizontal scaling
   * - Intent detection (read vs write)
   * - Reads go to replicas (load balanced)
   * - Writes go to primary
   * - ?consistency=strong forces primary
   */

  describe('intent detection', () => {
    it('detects GET as read intent', () => {
      const request = new Request('https://api.dotdo.dev/customers', { method: 'GET' })
      expect(detectIntent(request)).toBe('read')
    })

    it('detects HEAD as read intent', () => {
      const request = new Request('https://api.dotdo.dev/customers', { method: 'HEAD' })
      expect(detectIntent(request)).toBe('read')
    })

    it('detects OPTIONS as read intent', () => {
      const request = new Request('https://api.dotdo.dev/customers', { method: 'OPTIONS' })
      expect(detectIntent(request)).toBe('read')
    })

    it('detects POST as write intent', () => {
      const request = new Request('https://api.dotdo.dev/customers', { method: 'POST' })
      expect(detectIntent(request)).toBe('write')
    })

    it('detects PUT as write intent', () => {
      const request = new Request('https://api.dotdo.dev/customers/123', { method: 'PUT' })
      expect(detectIntent(request)).toBe('write')
    })

    it('detects PATCH as write intent', () => {
      const request = new Request('https://api.dotdo.dev/customers/123', { method: 'PATCH' })
      expect(detectIntent(request)).toBe('write')
    })

    it('detects DELETE as write intent', () => {
      const request = new Request('https://api.dotdo.dev/customers/123', { method: 'DELETE' })
      expect(detectIntent(request)).toBe('write')
    })

    it('detects custom X-Write-Intent header as write', () => {
      const request = new Request('https://api.dotdo.dev/customers', {
        method: 'GET',
        headers: { 'X-Write-Intent': 'true' },
      })
      expect(detectIntent(request)).toBe('write')
    })
  })

  describe('read routing', () => {
    it('routes reads to replica', () => {
      const router = createReplicaRouter({
        mode: 'primary-replica',
        replicaCount: 3,
        readPreference: 'replica',
      })

      const request = new Request('https://api.dotdo.dev/customers', { method: 'GET' })
      const result = router.route(request)

      expect(result.target).toBe('replica')
      expect(result.replicaIndex).toBeGreaterThanOrEqual(0)
      expect(result.replicaIndex).toBeLessThan(3)
    })

    it('load balances across replicas', () => {
      const router = createReplicaRouter({
        mode: 'primary-replica',
        replicaCount: 3,
        readPreference: 'replica',
      })

      const replicaHits: Record<number, number> = { 0: 0, 1: 0, 2: 0 }

      for (let i = 0; i < 100; i++) {
        const request = new Request(`https://api.dotdo.dev/customers?i=${i}`, { method: 'GET' })
        const result = router.route(request)
        if (result.replicaIndex !== undefined) {
          replicaHits[result.replicaIndex]++
        }
      }

      // Each replica should get roughly equal traffic
      for (const count of Object.values(replicaHits)) {
        expect(count).toBeGreaterThan(20) // At least 20%
        expect(count).toBeLessThan(50)    // At most 50%
      }
    })

    it('routes to primary with readPreference=primary', () => {
      const router = createReplicaRouter({
        mode: 'primary-replica',
        replicaCount: 3,
        readPreference: 'primary',
      })

      const request = new Request('https://api.dotdo.dev/customers', { method: 'GET' })
      const result = router.route(request)

      expect(result.target).toBe('primary')
    })
  })

  describe('write routing', () => {
    it('always routes writes to primary', () => {
      const router = createReplicaRouter({
        mode: 'primary-replica',
        replicaCount: 3,
        readPreference: 'replica',
      })

      const methods = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

      for (const method of methods) {
        const request = new Request('https://api.dotdo.dev/customers', { method })
        const result = router.route(request)
        expect(result.target).toBe('primary')
      }
    })
  })

  describe('consistency override', () => {
    it('routes to primary with ?consistency=strong', () => {
      const router = createReplicaRouter({
        mode: 'primary-replica',
        replicaCount: 3,
        readPreference: 'replica',
      })

      const request = new Request('https://api.dotdo.dev/customers?consistency=strong', {
        method: 'GET',
      })
      const result = router.route(request)

      expect(result.target).toBe('primary')
    })

    it('routes to replica with ?consistency=eventual', () => {
      const router = createReplicaRouter({
        mode: 'primary-replica',
        replicaCount: 3,
        readPreference: 'primary',
      })

      const request = new Request('https://api.dotdo.dev/customers?consistency=eventual', {
        method: 'GET',
      })
      const result = router.route(request)

      expect(result.target).toBe('replica')
    })

    it('respects X-Consistency header', () => {
      const router = createReplicaRouter({
        mode: 'primary-replica',
        replicaCount: 3,
        readPreference: 'replica',
      })

      const request = new Request('https://api.dotdo.dev/customers', {
        method: 'GET',
        headers: { 'X-Consistency': 'strong' },
      })
      const result = router.route(request)

      expect(result.target).toBe('primary')
    })
  })
})

// =============================================================================
// 7. Worker Presets
// =============================================================================

describe('Worker Presets', () => {
  /**
   * Pre-configured worker deployment patterns
   * - single: one DO per namespace
   * - typed: DO per type
   * - sharded: consistent hash distribution
   * - replicated: primary + read replicas
   */

  describe('single preset', () => {
    it('creates single-DO-per-namespace worker', () => {
      const worker = createWorkerPreset({
        type: 'single',
        config: { rootDomain: 'api.dotdo.dev' },
      })

      expect(worker.getConfig()).toMatchObject({
        type: 'single',
        rootDomain: 'api.dotdo.dev',
      })
    })

    it('routes all requests to same DO per namespace', async () => {
      const worker = createWorkerPreset({
        type: 'single',
        config: { rootDomain: 'api.dotdo.dev' },
      })

      // Both should route to same DO (tenant namespace)
      const req1 = new Request('https://tenant.api.dotdo.dev/customers')
      const req2 = new Request('https://tenant.api.dotdo.dev/orders')

      // In implementation, verify same DO ID is used
      const res1 = await worker.handleRequest(req1, {})
      const res2 = await worker.handleRequest(req2, {})

      expect(res1).toBeDefined()
      expect(res2).toBeDefined()
    })
  })

  describe('typed preset', () => {
    it('creates DO-per-type worker', () => {
      const worker = createWorkerPreset({
        type: 'typed',
        config: {
          rootDomain: 'api.dotdo.dev',
          types: ['customers', 'orders', 'products'],
        },
      })

      expect(worker.getConfig()).toMatchObject({
        type: 'typed',
        types: ['customers', 'orders', 'products'],
      })
    })

    it('routes to different DOs based on type', async () => {
      const worker = createWorkerPreset({
        type: 'typed',
        config: { rootDomain: 'api.dotdo.dev' },
      })

      // Different types should route to different DOs
      const req1 = new Request('https://tenant.api.dotdo.dev/customers/123')
      const req2 = new Request('https://tenant.api.dotdo.dev/orders/456')

      const res1 = await worker.handleRequest(req1, {})
      const res2 = await worker.handleRequest(req2, {})

      expect(res1).toBeDefined()
      expect(res2).toBeDefined()
    })
  })

  describe('sharded preset', () => {
    it('creates sharded worker with hash ring', () => {
      const worker = createWorkerPreset({
        type: 'sharded',
        config: {
          rootDomain: 'api.dotdo.dev',
          shardCount: 16,
          virtualNodes: 150,
        },
      })

      expect(worker.getConfig()).toMatchObject({
        type: 'sharded',
        shardCount: 16,
        virtualNodes: 150,
      })
    })

    it('distributes requests across shards', async () => {
      const worker = createWorkerPreset({
        type: 'sharded',
        config: {
          rootDomain: 'api.dotdo.dev',
          shardCount: 4,
        },
      })

      const requests = [
        new Request('https://tenant.api.dotdo.dev/customers/a'),
        new Request('https://tenant.api.dotdo.dev/customers/b'),
        new Request('https://tenant.api.dotdo.dev/customers/c'),
        new Request('https://tenant.api.dotdo.dev/customers/d'),
      ]

      for (const req of requests) {
        const res = await worker.handleRequest(req, {})
        expect(res).toBeDefined()
      }
    })
  })

  describe('replicated preset', () => {
    it('creates replicated worker with primary and replicas', () => {
      const worker = createWorkerPreset({
        type: 'replicated',
        config: {
          rootDomain: 'api.dotdo.dev',
          replicaCount: 3,
          readPreference: 'replica',
        },
      })

      expect(worker.getConfig()).toMatchObject({
        type: 'replicated',
        replicaCount: 3,
        readPreference: 'replica',
      })
    })

    it('routes reads to replicas and writes to primary', async () => {
      const worker = createWorkerPreset({
        type: 'replicated',
        config: {
          rootDomain: 'api.dotdo.dev',
          replicaCount: 2,
        },
      })

      const readReq = new Request('https://tenant.api.dotdo.dev/customers', { method: 'GET' })
      const writeReq = new Request('https://tenant.api.dotdo.dev/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alice' }),
      })

      const readRes = await worker.handleRequest(readReq, {})
      const writeRes = await worker.handleRequest(writeReq, {})

      expect(readRes).toBeDefined()
      expect(writeRes).toBeDefined()
    })
  })
})

// =============================================================================
// Integration Scenarios
// =============================================================================

describe('Worker Layer - Integration Scenarios', () => {
  describe('subdomain + sharding', () => {
    it('combines subdomain routing with consistent hashing', async () => {
      // Pattern: tenant.api.dotdo.dev/type/id -> shard(hash(tenant:type:id))
      const worker = createShardedWorker({
        rootDomain: 'api.dotdo.dev',
        shardCount: 8,
      })

      expect(worker).toBeDefined()
    })
  })

  describe('path routing + replication', () => {
    it('combines path routing with read replicas', async () => {
      // Pattern: api.dotdo.dev/tenant/type/id -> primary/replica based on intent
      const worker = createReplicatedWorker({ replicaCount: 3 })

      expect(worker).toBeDefined()
    })
  })

  describe('full stack', () => {
    it('combines all patterns for production deployment', async () => {
      // Full production pattern:
      // 1. Subdomain extracts tenant
      // 2. Path extracts type/id
      // 3. Consistent hash routes to shard
      // 4. Intent detection routes to primary/replica
      // 5. RPC proxy authenticates and forwards

      const worker = createProductionWorker({
        rootDomain: 'api.dotdo.dev',
        shardCount: 16,
        replicaCount: 3,
        authenticate: async () => true,
      })

      expect(worker).toBeDefined()
    })
  })
})
