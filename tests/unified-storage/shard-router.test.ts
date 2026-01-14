/**
 * ShardRouter RED Tests
 *
 * Failing tests that define the API for ShardRouter.
 * These tests should FAIL until ShardRouter is implemented.
 *
 * ShardRouter routes requests to appropriate DO shards based on partition key.
 * It supports multiple routing strategies:
 * - Hash-based: Consistent distribution using hash of partition key
 * - Consistent hash: Minimizes redistribution when shards change
 * - Range-based: Routes based on key ranges (time, alphabetic)
 *
 * Key features:
 * - Shard discovery and stub caching
 * - Request forwarding with header preservation
 * - Graceful error handling
 *
 * @see objects/unified-storage/shard-router.ts (to be implemented)
 * Issue: do-2tr.3.1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will FAIL - the module doesn't exist yet
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - ShardRouter not implemented yet (TDD RED phase)
import { ShardRouter, ConsistentHashRing, RangeRouter } from '../../objects/unified-storage/shard-router'

// ============================================================================
// Mock Durable Objects
// ============================================================================

/**
 * Mock DurableObjectId for testing
 */
function createMockDurableObjectId(name: string) {
  return {
    toString: () => `id:${name}`,
    name,
  }
}

/**
 * Mock DurableObjectStub for testing
 */
function createMockDurableObjectStub(name: string) {
  const responses: Map<string, Response> = new Map()

  return {
    name,
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const key = `${request.method}:${url.pathname}`

      if (responses.has(key)) {
        return responses.get(key)!
      }

      // Default response
      return new Response(JSON.stringify({ shard: name, path: url.pathname }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
    _setResponse: (method: string, path: string, response: Response) => {
      responses.set(`${method}:${path}`, response)
    },
    _getCallCount: () => (responses as unknown as { fetch: { mock: { calls: unknown[] } } }).fetch?.mock?.calls?.length || 0,
  }
}

/**
 * Mock DurableObjectNamespace for testing
 */
function createMockDurableObjectNamespace() {
  const stubs = new Map<string, ReturnType<typeof createMockDurableObjectStub>>()

  return {
    idFromName: vi.fn((name: string) => createMockDurableObjectId(name)),
    get: vi.fn((id: ReturnType<typeof createMockDurableObjectId>) => {
      const name = id.name || id.toString()
      if (!stubs.has(name)) {
        stubs.set(name, createMockDurableObjectStub(name))
      }
      return stubs.get(name)!
    }),
    _getStubs: () => stubs,
    _getStub: (name: string) => stubs.get(name),
  }
}

// ============================================================================
// Hash-Based Routing Tests
// ============================================================================

describe('ShardRouter', () => {
  describe('hash-based routing', () => {
    let namespace: ReturnType<typeof createMockDurableObjectNamespace>
    let router: InstanceType<typeof ShardRouter>

    beforeEach(() => {
      namespace = createMockDurableObjectNamespace()
      router = new ShardRouter({
        namespace,
        shardCount: 16,
        strategy: 'hash',
      })
    })

    it('should route to shard based on hash of partition key', () => {
      // Given: A partition key
      const partitionKey = 'customer-12345'

      // When: Getting the shard index
      const shardIndex = router.getShardIndex(partitionKey)

      // Then: Should return a valid shard index
      expect(shardIndex).toBeGreaterThanOrEqual(0)
      expect(shardIndex).toBeLessThan(16)
      expect(Number.isInteger(shardIndex)).toBe(true)
    })

    it('should distribute keys evenly across shards', () => {
      // Given: Many partition keys
      const keyCount = 10000
      const shardCounts = new Map<number, number>()

      // When: Routing all keys
      for (let i = 0; i < keyCount; i++) {
        const key = `key-${i}-${Math.random().toString(36)}`
        const shardIndex = router.getShardIndex(key)
        shardCounts.set(shardIndex, (shardCounts.get(shardIndex) || 0) + 1)
      }

      // Then: Distribution should be roughly even (within 30% of expected)
      const expectedPerShard = keyCount / 16
      const tolerance = expectedPerShard * 0.3

      for (let shard = 0; shard < 16; shard++) {
        const count = shardCounts.get(shard) || 0
        expect(count).toBeGreaterThan(expectedPerShard - tolerance)
        expect(count).toBeLessThan(expectedPerShard + tolerance)
      }
    })

    it('should always route same key to same shard', () => {
      // Given: A fixed partition key
      const partitionKey = 'stable-partition-key-abc'

      // When: Getting shard index multiple times
      const indices: number[] = []
      for (let i = 0; i < 100; i++) {
        indices.push(router.getShardIndex(partitionKey))
      }

      // Then: All indices should be the same
      const firstIndex = indices[0]
      expect(indices.every(idx => idx === firstIndex)).toBe(true)
    })

    it('should support configurable number of shards', () => {
      // Given: Routers with different shard counts
      const router4 = new ShardRouter({ namespace, shardCount: 4, strategy: 'hash' })
      const router8 = new ShardRouter({ namespace, shardCount: 8, strategy: 'hash' })
      const router32 = new ShardRouter({ namespace, shardCount: 32, strategy: 'hash' })

      // When: Routing many keys
      const keys = Array.from({ length: 1000 }, (_, i) => `key-${i}`)

      // Then: Each router should respect its shard count
      for (const key of keys) {
        expect(router4.getShardIndex(key)).toBeLessThan(4)
        expect(router8.getShardIndex(key)).toBeLessThan(8)
        expect(router32.getShardIndex(key)).toBeLessThan(32)
      }
    })

    it('should handle special characters in partition keys', () => {
      // Given: Keys with special characters
      const specialKeys = [
        'user:alice@example.com',
        'order/2024/01/15/12345',
        'document#section-1',
        'data?filter=active&sort=desc',
        'path\\to\\resource',
        'emoji_key',
        'unicode_',
        '',
        '   spaces   ',
      ]

      // When/Then: All should route successfully
      for (const key of specialKeys) {
        const index = router.getShardIndex(key)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(16)
      }
    })
  })

  // ============================================================================
  // Consistent Hash Routing Tests
  // ============================================================================

  describe('consistent hash routing', () => {
    let namespace: ReturnType<typeof createMockDurableObjectNamespace>

    beforeEach(() => {
      namespace = createMockDurableObjectNamespace()
    })

    it('should use consistent hashing for stability', () => {
      // Given: A consistent hash router
      const router = new ShardRouter({
        namespace,
        shardCount: 16,
        strategy: 'consistent-hash',
      })

      // When: Routing the same key
      const key = 'stable-key-123'
      const index1 = router.getShardIndex(key)

      // Create a new router with same config
      const router2 = new ShardRouter({
        namespace,
        shardCount: 16,
        strategy: 'consistent-hash',
      })
      const index2 = router2.getShardIndex(key)

      // Then: Should route to the same shard
      expect(index1).toBe(index2)
    })

    it('should minimize redistribution when adding shard', () => {
      // Given: Router with N shards and a set of keys
      const router16 = new ShardRouter({
        namespace,
        shardCount: 16,
        strategy: 'consistent-hash',
      })

      const keys = Array.from({ length: 1000 }, (_, i) => `key-${i}`)
      const originalMapping = new Map<string, number>()

      for (const key of keys) {
        originalMapping.set(key, router16.getShardIndex(key))
      }

      // When: Adding a shard (N+1 shards)
      const router17 = new ShardRouter({
        namespace,
        shardCount: 17,
        strategy: 'consistent-hash',
      })

      // Then: Most keys should stay on the same shard
      // Only ~1/N keys should move (in this case ~1/17 = ~6%)
      let movedCount = 0
      for (const key of keys) {
        const newIndex = router17.getShardIndex(key)
        if (originalMapping.get(key) !== newIndex) {
          movedCount++
        }
      }

      // Allow 15% tolerance (2x expected) for implementation variance
      const maxExpectedMoves = Math.ceil(keys.length * 0.15)
      expect(movedCount).toBeLessThan(maxExpectedMoves)
    })

    it('should minimize redistribution when removing shard', () => {
      // Given: Router with N shards and a set of keys
      const router16 = new ShardRouter({
        namespace,
        shardCount: 16,
        strategy: 'consistent-hash',
      })

      const keys = Array.from({ length: 1000 }, (_, i) => `key-${i}`)
      const originalMapping = new Map<string, number>()

      for (const key of keys) {
        originalMapping.set(key, router16.getShardIndex(key))
      }

      // When: Removing a shard (N-1 shards)
      const router15 = new ShardRouter({
        namespace,
        shardCount: 15,
        strategy: 'consistent-hash',
      })

      // Then: Only keys from removed shard should move
      // ~1/N keys should move (in this case ~1/16 = ~6%)
      let movedCount = 0
      for (const key of keys) {
        const newIndex = router15.getShardIndex(key)
        if (originalMapping.get(key) !== newIndex) {
          movedCount++
        }
      }

      // Allow 15% tolerance for implementation variance
      const maxExpectedMoves = Math.ceil(keys.length * 0.15)
      expect(movedCount).toBeLessThan(maxExpectedMoves)
    })

    it('should support virtual nodes for better distribution', () => {
      // Given: Router with virtual nodes
      const router = new ShardRouter({
        namespace,
        shardCount: 4,
        strategy: 'consistent-hash',
        virtualNodes: 150, // 150 virtual nodes per physical shard
      })

      // When: Routing many keys
      const keyCount = 10000
      const shardCounts = new Map<number, number>()

      for (let i = 0; i < keyCount; i++) {
        const key = `key-${i}`
        const shardIndex = router.getShardIndex(key)
        shardCounts.set(shardIndex, (shardCounts.get(shardIndex) || 0) + 1)
      }

      // Then: Distribution should be very even with virtual nodes
      // (better than basic consistent hashing)
      const expectedPerShard = keyCount / 4
      const tolerance = expectedPerShard * 0.2 // 20% tolerance

      for (let shard = 0; shard < 4; shard++) {
        const count = shardCounts.get(shard) || 0
        expect(count).toBeGreaterThan(expectedPerShard - tolerance)
        expect(count).toBeLessThan(expectedPerShard + tolerance)
      }
    })

    it('should expose ConsistentHashRing for custom usage', () => {
      // Given: A consistent hash ring
      const ring = new ConsistentHashRing({
        nodes: ['shard-0', 'shard-1', 'shard-2', 'shard-3'],
        virtualNodes: 100,
      })

      // When: Looking up keys
      const node1 = ring.getNode('user-123')
      const node2 = ring.getNode('user-456')

      // Then: Should return valid node names
      expect(node1).toMatch(/^shard-\d$/)
      expect(node2).toMatch(/^shard-\d$/)

      // And: Should be consistent
      expect(ring.getNode('user-123')).toBe(node1)
    })

    it('should handle node addition in hash ring', () => {
      // Given: A hash ring with 3 nodes
      const ring = new ConsistentHashRing({
        nodes: ['shard-0', 'shard-1', 'shard-2'],
        virtualNodes: 100,
      })

      const keys = Array.from({ length: 100 }, (_, i) => `key-${i}`)
      const originalMapping = new Map<string, string>()

      for (const key of keys) {
        originalMapping.set(key, ring.getNode(key))
      }

      // When: Adding a node
      ring.addNode('shard-3')

      // Then: Most keys should stay on original nodes
      let movedCount = 0
      for (const key of keys) {
        if (originalMapping.get(key) !== ring.getNode(key)) {
          movedCount++
        }
      }

      // Only ~25% of keys should move (1/4 for new node)
      expect(movedCount).toBeLessThan(keys.length * 0.4)
    })

    it('should handle node removal in hash ring', () => {
      // Given: A hash ring with 4 nodes
      const ring = new ConsistentHashRing({
        nodes: ['shard-0', 'shard-1', 'shard-2', 'shard-3'],
        virtualNodes: 100,
      })

      const keys = Array.from({ length: 100 }, (_, i) => `key-${i}`)
      const originalMapping = new Map<string, string>()

      for (const key of keys) {
        originalMapping.set(key, ring.getNode(key))
      }

      // When: Removing a node
      ring.removeNode('shard-2')

      // Then: Only keys from removed node should move
      let movedCount = 0
      for (const key of keys) {
        if (originalMapping.get(key) !== ring.getNode(key)) {
          movedCount++
        }
        // Keys should NOT map to removed node
        expect(ring.getNode(key)).not.toBe('shard-2')
      }

      // Only ~25% of keys should move (those on removed node)
      expect(movedCount).toBeLessThan(keys.length * 0.4)
    })
  })

  // ============================================================================
  // Range-Based Routing Tests
  // ============================================================================

  describe('range-based routing', () => {
    let namespace: ReturnType<typeof createMockDurableObjectNamespace>

    beforeEach(() => {
      namespace = createMockDurableObjectNamespace()
    })

    it('should route based on key range', () => {
      // Given: A range-based router
      const router = new ShardRouter({
        namespace,
        strategy: 'range',
        ranges: [
          { start: 'a', end: 'm', shard: 0 },
          { start: 'm', end: 'z', shard: 1 },
        ],
      })

      // When/Then: Keys should route to correct shards
      expect(router.getShardIndex('alice')).toBe(0)
      expect(router.getShardIndex('bob')).toBe(0)
      expect(router.getShardIndex('nancy')).toBe(1)
      expect(router.getShardIndex('zoe')).toBe(1)
    })

    it('should support time-based ranges', () => {
      // Given: A time-based range router (e.g., for time-series data)
      const router = new ShardRouter({
        namespace,
        strategy: 'range',
        ranges: [
          { start: '2024-01', end: '2024-04', shard: 0 }, // Q1 2024
          { start: '2024-04', end: '2024-07', shard: 1 }, // Q2 2024
          { start: '2024-07', end: '2024-10', shard: 2 }, // Q3 2024
          { start: '2024-10', end: '2025-01', shard: 3 }, // Q4 2024
        ],
      })

      // When/Then: Time-based keys should route correctly
      expect(router.getShardIndex('2024-01-15')).toBe(0)
      expect(router.getShardIndex('2024-03-30')).toBe(0)
      expect(router.getShardIndex('2024-05-01')).toBe(1)
      expect(router.getShardIndex('2024-08-15')).toBe(2)
      expect(router.getShardIndex('2024-11-01')).toBe(3)
    })

    it('should support alphabetic ranges', () => {
      // Given: An alphabetic range router (e.g., for customer last names)
      const router = new ShardRouter({
        namespace,
        strategy: 'range',
        ranges: [
          { start: 'A', end: 'G', shard: 0 },
          { start: 'G', end: 'M', shard: 1 },
          { start: 'M', end: 'S', shard: 2 },
          { start: 'S', end: 'Z', shard: 3 },
        ],
      })

      // When/Then: Names should route by first letter
      expect(router.getShardIndex('Anderson')).toBe(0)
      expect(router.getShardIndex('Baker')).toBe(0)
      expect(router.getShardIndex('Garcia')).toBe(1)
      expect(router.getShardIndex('Johnson')).toBe(1)
      expect(router.getShardIndex('Miller')).toBe(2)
      expect(router.getShardIndex('Smith')).toBe(3)
      expect(router.getShardIndex('Williams')).toBe(3)
    })

    it('should handle keys outside defined ranges', () => {
      // Given: A range router with gaps
      const router = new ShardRouter({
        namespace,
        strategy: 'range',
        ranges: [
          { start: 'b', end: 'd', shard: 0 },
          { start: 'f', end: 'h', shard: 1 },
        ],
        defaultShard: 2, // Default for keys outside ranges
      })

      // When/Then: Out-of-range keys should go to default
      expect(router.getShardIndex('apple')).toBe(2) // Before 'b'
      expect(router.getShardIndex('echo')).toBe(2) // Between 'd' and 'f'
      expect(router.getShardIndex('zebra')).toBe(2) // After 'h'
    })

    it('should support custom range comparator', () => {
      // Given: A router with numeric ranges
      const router = new ShardRouter({
        namespace,
        strategy: 'range',
        ranges: [
          { start: 0, end: 1000, shard: 0 },
          { start: 1000, end: 10000, shard: 1 },
          { start: 10000, end: 100000, shard: 2 },
        ],
        comparator: (key: string) => parseInt(key, 10),
      })

      // When/Then: Numeric keys should route correctly
      expect(router.getShardIndex('500')).toBe(0)
      expect(router.getShardIndex('5000')).toBe(1)
      expect(router.getShardIndex('50000')).toBe(2)
    })

    it('should expose RangeRouter for custom usage', () => {
      // Given: A standalone range router
      const rangeRouter = new RangeRouter({
        ranges: [
          { start: 'a', end: 'f', value: 'shard-0' },
          { start: 'f', end: 'k', value: 'shard-1' },
          { start: 'k', end: 'p', value: 'shard-2' },
          { start: 'p', end: 'z', value: 'shard-3' },
        ],
      })

      // When: Looking up values
      const result1 = rangeRouter.lookup('apple')
      const result2 = rangeRouter.lookup('grape')
      const result3 = rangeRouter.lookup('lemon')
      const result4 = rangeRouter.lookup('raspberry')

      // Then: Should return correct values
      expect(result1).toBe('shard-0')
      expect(result2).toBe('shard-1')
      expect(result3).toBe('shard-2')
      expect(result4).toBe('shard-3')
    })
  })

  // ============================================================================
  // Shard Discovery Tests
  // ============================================================================

  describe('shard discovery', () => {
    let namespace: ReturnType<typeof createMockDurableObjectNamespace>
    let router: InstanceType<typeof ShardRouter>

    beforeEach(() => {
      namespace = createMockDurableObjectNamespace()
      router = new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'hash',
      })
    })

    it('should get DO stub for target shard', () => {
      // Given: A partition key
      const partitionKey = 'customer-12345'

      // When: Getting the stub
      const stub = router.getStub(partitionKey)

      // Then: Should return a valid stub
      expect(stub).toBeDefined()
      expect(stub.fetch).toBeDefined()
      expect(typeof stub.fetch).toBe('function')
    })

    it('should cache shard stubs', () => {
      // Given: Multiple requests for the same partition key
      const partitionKey = 'customer-12345'

      // When: Getting stubs multiple times
      const stub1 = router.getStub(partitionKey)
      const stub2 = router.getStub(partitionKey)
      const stub3 = router.getStub(partitionKey)

      // Then: Should return the same cached stub
      expect(stub1).toBe(stub2)
      expect(stub2).toBe(stub3)

      // And: namespace.get should only be called once
      const shardIndex = router.getShardIndex(partitionKey)
      expect(namespace.get).toHaveBeenCalledTimes(1)
    })

    it('should handle shard not found', () => {
      // Given: A router with a namespace that throws
      const failingNamespace = {
        idFromName: vi.fn(() => createMockDurableObjectId('test')),
        get: vi.fn(() => {
          throw new Error('Shard unavailable')
        }),
      }

      const failingRouter = new ShardRouter({
        namespace: failingNamespace as unknown as ReturnType<typeof createMockDurableObjectNamespace>,
        shardCount: 8,
        strategy: 'hash',
      })

      // When/Then: Getting stub should throw with meaningful error
      expect(() => failingRouter.getStub('test-key')).toThrow('Shard unavailable')
    })

    it('should get all shards for scatter-gather queries', () => {
      // Given: A router with 8 shards

      // When: Getting all stubs
      const stubs = router.getAllStubs()

      // Then: Should return all 8 stubs
      expect(stubs.length).toBe(8)
      expect(stubs.every(stub => stub.fetch)).toBe(true)
    })

    it('should return shard metadata', () => {
      // Given: A partition key

      // When: Getting shard info
      const info = router.getShardInfo('customer-12345')

      // Then: Should include useful metadata
      expect(info.shardIndex).toBeDefined()
      expect(info.shardName).toBeDefined()
      expect(info.shardIndex).toBeGreaterThanOrEqual(0)
      expect(info.shardIndex).toBeLessThan(8)
      expect(typeof info.shardName).toBe('string')
    })

    it('should use custom shard naming', () => {
      // Given: A router with custom shard naming
      const customRouter = new ShardRouter({
        namespace,
        shardCount: 4,
        strategy: 'hash',
        shardNamePrefix: 'unified-store-shard-',
      })

      // When: Getting shard info
      const info = customRouter.getShardInfo('test-key')

      // Then: Shard name should use custom prefix
      expect(info.shardName).toMatch(/^unified-store-shard-\d$/)
    })
  })

  // ============================================================================
  // Request Forwarding Tests
  // ============================================================================

  describe('request forwarding', () => {
    let namespace: ReturnType<typeof createMockDurableObjectNamespace>
    let router: InstanceType<typeof ShardRouter>

    beforeEach(() => {
      namespace = createMockDurableObjectNamespace()
      router = new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'hash',
      })
    })

    it('should forward request to correct shard', async () => {
      // Given: A request with partition key
      const partitionKey = 'customer-12345'
      const request = new Request('https://api.example.com/things/customer-12345', {
        method: 'GET',
      })

      // When: Forwarding the request
      const response = await router.forward(partitionKey, request)

      // Then: Should get response from correct shard
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.path).toBe('/things/customer-12345')
    })

    it('should preserve request headers', async () => {
      // Given: A request with custom headers
      const partitionKey = 'customer-12345'
      const request = new Request('https://api.example.com/things', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token123',
        },
        body: JSON.stringify({ name: 'Test' }),
      })

      // When: Forwarding the request
      const stub = router.getStub(partitionKey) as ReturnType<typeof createMockDurableObjectStub>
      await router.forward(partitionKey, request)

      // Then: Headers should be preserved in the forwarded request
      expect(stub.fetch).toHaveBeenCalled()
      const forwardedRequest = (stub.fetch as unknown as { mock: { calls: [Request][] } }).mock.calls[0][0]
      expect(forwardedRequest.headers.get('Content-Type')).toBe('application/json')
      expect(forwardedRequest.headers.get('X-Custom-Header')).toBe('custom-value')
      expect(forwardedRequest.headers.get('Authorization')).toBe('Bearer token123')
    })

    it('should handle shard errors gracefully', async () => {
      // Given: A shard that returns an error
      const partitionKey = 'error-key'
      const stub = router.getStub(partitionKey) as ReturnType<typeof createMockDurableObjectStub>
      stub.fetch.mockImplementation(async () => {
        return new Response(JSON.stringify({ error: 'Internal error' }), {
          status: 500,
        })
      })

      const request = new Request('https://api.example.com/things')

      // When: Forwarding to failing shard
      const response = await router.forward(partitionKey, request)

      // Then: Should propagate the error response
      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toBe('Internal error')
    })

    it('should handle network errors', async () => {
      // Given: A shard that throws
      const partitionKey = 'network-error-key'
      const stub = router.getStub(partitionKey) as ReturnType<typeof createMockDurableObjectStub>
      stub.fetch.mockImplementation(async () => {
        throw new Error('Network timeout')
      })

      const request = new Request('https://api.example.com/things')

      // When/Then: Forwarding should throw or return error response
      await expect(router.forward(partitionKey, request)).rejects.toThrow('Network timeout')
    })

    it('should support retry on transient errors', async () => {
      // Given: A router with retry config
      const retryRouter = new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'hash',
        retryConfig: {
          maxRetries: 3,
          retryDelayMs: 100,
          retryableStatuses: [502, 503, 504],
        },
      })

      let attemptCount = 0
      const stub = retryRouter.getStub('retry-key') as ReturnType<typeof createMockDurableObjectStub>
      stub.fetch.mockImplementation(async () => {
        attemptCount++
        if (attemptCount < 3) {
          return new Response('Service unavailable', { status: 503 })
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 })
      })

      const request = new Request('https://api.example.com/things')

      // When: Forwarding with retries
      const response = await retryRouter.forward('retry-key', request)

      // Then: Should eventually succeed after retries
      expect(response.ok).toBe(true)
      expect(attemptCount).toBe(3)
    })

    it('should add shard routing headers', async () => {
      // Given: A router configured to add routing headers
      const headerRouter = new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'hash',
        addRoutingHeaders: true,
      })

      const partitionKey = 'customer-12345'
      const stub = headerRouter.getStub(partitionKey) as ReturnType<typeof createMockDurableObjectStub>
      const request = new Request('https://api.example.com/things')

      // When: Forwarding the request
      await headerRouter.forward(partitionKey, request)

      // Then: Routing headers should be added
      const forwardedRequest = (stub.fetch as unknown as { mock: { calls: [Request][] } }).mock.calls[0][0]
      expect(forwardedRequest.headers.get('X-Shard-Index')).toBeDefined()
      expect(forwardedRequest.headers.get('X-Shard-Name')).toBeDefined()
      expect(forwardedRequest.headers.get('X-Partition-Key')).toBe(partitionKey)
    })

    it('should support scatter-gather queries', async () => {
      // Given: Data distributed across shards

      // When: Querying all shards
      const request = new Request('https://api.example.com/things?type=Customer')
      const responses = await router.scatterGather(request)

      // Then: Should get responses from all shards
      expect(responses.length).toBe(8)
      expect(responses.every(r => r.ok)).toBe(true)
    })

    it('should aggregate scatter-gather results', async () => {
      // Given: Shards returning arrays of results
      const stubs = router.getAllStubs()
      stubs.forEach((stub, i) => {
        (stub.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
          return new Response(JSON.stringify({
            items: [{ id: `item-${i}-1` }, { id: `item-${i}-2` }],
            count: 2,
          }), { status: 200 })
        })
      })

      const request = new Request('https://api.example.com/things')

      // When: Aggregating results
      const aggregated = await router.scatterGatherAggregate(request, {
        aggregate: (responses) => {
          const allItems: unknown[] = []
          let totalCount = 0
          for (const data of responses) {
            allItems.push(...(data.items as unknown[]))
            totalCount += data.count as number
          }
          return { items: allItems, totalCount }
        },
      })

      // Then: Should have combined results
      expect(aggregated.totalCount).toBe(16) // 2 items * 8 shards
      expect((aggregated.items as unknown[]).length).toBe(16)
    })
  })

  // ============================================================================
  // Configuration Tests
  // ============================================================================

  describe('configuration', () => {
    it('should validate shard count', () => {
      const namespace = createMockDurableObjectNamespace()

      // Invalid shard counts should throw
      expect(() => new ShardRouter({
        namespace,
        shardCount: 0,
        strategy: 'hash',
      })).toThrow()

      expect(() => new ShardRouter({
        namespace,
        shardCount: -1,
        strategy: 'hash',
      })).toThrow()
    })

    it('should validate strategy', () => {
      const namespace = createMockDurableObjectNamespace()

      expect(() => new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'invalid-strategy' as 'hash',
      })).toThrow()
    })

    it('should require ranges for range strategy', () => {
      const namespace = createMockDurableObjectNamespace()

      expect(() => new ShardRouter({
        namespace,
        strategy: 'range',
        // Missing ranges
      })).toThrow()
    })

    it('should expose configuration', () => {
      const namespace = createMockDurableObjectNamespace()
      const router = new ShardRouter({
        namespace,
        shardCount: 16,
        strategy: 'hash',
        virtualNodes: 100,
      })

      const config = router.getConfig()

      expect(config.shardCount).toBe(16)
      expect(config.strategy).toBe('hash')
      expect(config.virtualNodes).toBe(100)
    })
  })

  // ============================================================================
  // Metrics Tests
  // ============================================================================

  describe('metrics', () => {
    it('should track routing operations', async () => {
      const namespace = createMockDurableObjectNamespace()
      const router = new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'hash',
        enableMetrics: true,
      })

      // Perform some routing operations
      for (let i = 0; i < 100; i++) {
        router.getShardIndex(`key-${i}`)
      }

      // Get metrics
      const metrics = router.getMetrics()

      expect(metrics.routingOperations).toBe(100)
      expect(metrics.shardDistribution).toBeDefined()
    })

    it('should track forward operations', async () => {
      const namespace = createMockDurableObjectNamespace()
      const router = new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'hash',
        enableMetrics: true,
      })

      const request = new Request('https://api.example.com/things')

      // Perform forward operations
      for (let i = 0; i < 10; i++) {
        await router.forward(`key-${i}`, request)
      }

      const metrics = router.getMetrics()

      expect(metrics.forwardOperations).toBe(10)
      expect(metrics.averageLatencyMs).toBeDefined()
    })

    it('should track errors', async () => {
      const namespace = createMockDurableObjectNamespace()
      const router = new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'hash',
        enableMetrics: true,
      })

      const stub = router.getStub('error-key') as ReturnType<typeof createMockDurableObjectStub>
      stub.fetch.mockImplementation(async () => {
        throw new Error('Shard error')
      })

      const request = new Request('https://api.example.com/things')

      // Try to forward (will fail)
      try {
        await router.forward('error-key', request)
      } catch {
        // Expected
      }

      const metrics = router.getMetrics()

      expect(metrics.errorCount).toBe(1)
    })

    it('should reset metrics', () => {
      const namespace = createMockDurableObjectNamespace()
      const router = new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'hash',
        enableMetrics: true,
      })

      // Generate some metrics
      for (let i = 0; i < 50; i++) {
        router.getShardIndex(`key-${i}`)
      }

      expect(router.getMetrics().routingOperations).toBe(50)

      // Reset
      router.resetMetrics()

      expect(router.getMetrics().routingOperations).toBe(0)
    })
  })

  // ============================================================================
  // Virtual Nodes Configuration Tests
  // ============================================================================

  describe('virtual nodes configuration', () => {
    let namespace: ReturnType<typeof createMockDurableObjectNamespace>

    beforeEach(() => {
      namespace = createMockDurableObjectNamespace()
    })

    it('should use 150 virtual nodes by default', () => {
      // Given: A consistent hash ring without explicit virtualNodes config
      const ring = new ConsistentHashRing({
        nodes: ['shard-0', 'shard-1', 'shard-2', 'shard-3'],
      })

      // Then: Should use 150 virtual nodes per physical node (new default)
      expect(ring.getVirtualNodesPerNode()).toBe(150)
      expect(ring.getTotalVirtualNodes()).toBe(4 * 150) // 4 nodes * 150 vnodes
    })

    it('should expose DEFAULT_VIRTUAL_NODES constant', () => {
      // Verify the constant is exposed and set to 150
      expect(ConsistentHashRing.DEFAULT_VIRTUAL_NODES).toBe(150)
    })

    it('should allow custom virtual node configuration', () => {
      // Given: Rings with different virtual node counts
      const ring50 = new ConsistentHashRing({
        nodes: ['a', 'b'],
        virtualNodes: 50,
      })
      const ring200 = new ConsistentHashRing({
        nodes: ['a', 'b'],
        virtualNodes: 200,
      })
      const ring300 = new ConsistentHashRing({
        nodes: ['a', 'b'],
        virtualNodes: 300,
      })

      // Then: Each should use its configured virtual nodes
      expect(ring50.getVirtualNodesPerNode()).toBe(50)
      expect(ring50.getTotalVirtualNodes()).toBe(100)

      expect(ring200.getVirtualNodesPerNode()).toBe(200)
      expect(ring200.getTotalVirtualNodes()).toBe(400)

      expect(ring300.getVirtualNodesPerNode()).toBe(300)
      expect(ring300.getTotalVirtualNodes()).toBe(600)
    })

    it('should show improved distribution with more virtual nodes', () => {
      // Given: Rings with different virtual node counts
      const ring10 = new ConsistentHashRing({
        nodes: ['a', 'b', 'c', 'd'],
        virtualNodes: 10,
      })
      const ring150 = new ConsistentHashRing({
        nodes: ['a', 'b', 'c', 'd'],
        virtualNodes: 150,
      })

      // When: Getting distribution metrics
      const metrics10 = ring10.getDistributionMetrics(10000)
      const metrics150 = ring150.getDistributionMetrics(10000)

      // Then: More virtual nodes should produce better balance
      // (lower coefficient of variation, higher balance score)
      expect(metrics150.balanceScore).toBeGreaterThanOrEqual(metrics10.balanceScore)
      expect(metrics150.coefficientOfVariation).toBeLessThanOrEqual(metrics10.coefficientOfVariation + 0.05)
    })

    it('should use default virtual nodes in ShardRouter for consistent-hash', () => {
      // Given: A ShardRouter without explicit virtualNodes
      const router = new ShardRouter({
        namespace,
        shardCount: 8,
        strategy: 'consistent-hash',
      })

      // Then: Should use 150 virtual nodes (the new default)
      const config = router.getConfig()
      expect(config.virtualNodes).toBe(150)
    })
  })

  // ============================================================================
  // Distribution Metrics Tests
  // ============================================================================

  describe('distribution metrics', () => {
    let namespace: ReturnType<typeof createMockDurableObjectNamespace>

    beforeEach(() => {
      namespace = createMockDurableObjectNamespace()
    })

    it('should calculate distribution metrics for ConsistentHashRing', () => {
      // Given: A hash ring with 4 nodes
      const ring = new ConsistentHashRing({
        nodes: ['shard-0', 'shard-1', 'shard-2', 'shard-3'],
        virtualNodes: 150,
      })

      // When: Getting distribution metrics
      const metrics = ring.getDistributionMetrics(10000)

      // Then: Should return all expected fields
      expect(metrics.nodeCount).toBe(4)
      expect(metrics.totalVirtualNodes).toBe(600) // 4 * 150
      expect(metrics.virtualNodesPerNode).toBe(150)
      expect(metrics.distribution.size).toBe(4)
      expect(typeof metrics.standardDeviation).toBe('number')
      expect(typeof metrics.coefficientOfVariation).toBe('number')
      expect(typeof metrics.minMaxRatio).toBe('number')
      expect(typeof metrics.balanceScore).toBe('number')
    })

    it('should show good balance score with 150 virtual nodes', () => {
      // Given: A well-configured ring
      const ring = new ConsistentHashRing({
        nodes: ['a', 'b', 'c', 'd'],
        virtualNodes: 150,
      })

      // When: Getting distribution metrics
      const metrics = ring.getDistributionMetrics(10000)

      // Then: Balance score should be high (good distribution)
      expect(metrics.balanceScore).toBeGreaterThan(80) // At least 80% balanced
      expect(metrics.coefficientOfVariation).toBeLessThan(0.15) // CV < 15%
      expect(metrics.minMaxRatio).toBeGreaterThan(0.7) // Min is at least 70% of max
    })

    it('should handle empty ring gracefully', () => {
      // Given: An empty ring
      const ring = new ConsistentHashRing({ nodes: [] })

      // When: Getting distribution metrics
      const metrics = ring.getDistributionMetrics()

      // Then: Should return sensible defaults
      expect(metrics.nodeCount).toBe(0)
      expect(metrics.totalVirtualNodes).toBe(0)
      expect(metrics.balanceScore).toBe(100) // Perfect by default (nothing to distribute)
      expect(metrics.distribution.size).toBe(0)
    })

    it('should track distribution per node', () => {
      // Given: A ring with 3 nodes
      const ring = new ConsistentHashRing({
        nodes: ['alpha', 'beta', 'gamma'],
        virtualNodes: 100,
      })

      // When: Getting distribution metrics
      const metrics = ring.getDistributionMetrics(9000) // Divisible by 3

      // Then: Should have counts for each node
      expect(metrics.distribution.has('alpha')).toBe(true)
      expect(metrics.distribution.has('beta')).toBe(true)
      expect(metrics.distribution.has('gamma')).toBe(true)

      // Total should equal sample size
      let total = 0
      for (const count of metrics.distribution.values()) {
        total += count
      }
      expect(total).toBe(9000)
    })

    it('should expose distribution metrics from ShardRouter', () => {
      // Given: A ShardRouter with consistent-hash strategy
      const router = new ShardRouter({
        namespace,
        shardCount: 4,
        strategy: 'consistent-hash',
        virtualNodes: 150,
      })

      // When: Getting distribution metrics
      const metrics = router.getDistributionMetrics()

      // Then: Should return valid metrics
      expect(metrics).not.toBeNull()
      expect(metrics!.nodeCount).toBe(4)
      expect(metrics!.balanceScore).toBeGreaterThan(70)
    })

    it('should return null for non-consistent-hash strategies', () => {
      // Given: Routers with non-consistent-hash strategies
      const hashRouter = new ShardRouter({
        namespace,
        shardCount: 4,
        strategy: 'hash',
      })
      const rangeRouter = new ShardRouter({
        namespace,
        strategy: 'range',
        ranges: [
          { start: 'a', end: 'm', shard: 0 },
          { start: 'm', end: 'z', shard: 1 },
        ],
      })

      // When/Then: getDistributionMetrics should return null
      expect(hashRouter.getDistributionMetrics()).toBeNull()
      expect(rangeRouter.getDistributionMetrics()).toBeNull()
    })

    it('should support custom sample size', () => {
      // Given: A hash ring
      const ring = new ConsistentHashRing({
        nodes: ['a', 'b'],
        virtualNodes: 100,
      })

      // When: Getting metrics with different sample sizes
      const metrics1000 = ring.getDistributionMetrics(1000)
      const metrics50000 = ring.getDistributionMetrics(50000)

      // Then: Both should work, larger sample should have similar balance
      expect(metrics1000.nodeCount).toBe(2)
      expect(metrics50000.nodeCount).toBe(2)

      // Total distributed should match sample size
      let total1000 = 0
      let total50000 = 0
      for (const count of metrics1000.distribution.values()) total1000 += count
      for (const count of metrics50000.distribution.values()) total50000 += count
      expect(total1000).toBe(1000)
      expect(total50000).toBe(50000)
    })

    it('should calculate correct standard deviation', () => {
      // Given: A ring with 2 nodes for easy calculation
      const ring = new ConsistentHashRing({
        nodes: ['x', 'y'],
        virtualNodes: 150,
      })

      // When: Getting metrics
      const metrics = ring.getDistributionMetrics(10000)

      // Then: Standard deviation should be reasonable
      // For perfectly balanced: 5000, 5000 -> stdDev = 0
      // For slightly unbalanced: 4800, 5200 -> stdDev = 200
      // Allow up to ~500 stdDev for real-world hashing (5% variance)
      expect(metrics.standardDeviation).toBeLessThan(500)
    })
  })
})
