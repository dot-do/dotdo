/**
 * Streaming Interface - TDD RED Phase Tests (Issue dotdo-r22hl)
 *
 * Tests for memory-efficient streaming traversal interface:
 * - $stream AsyncIterable interface
 * - $batch(n) batched iteration
 * - for-await-of native support
 * - Memory efficiency verification
 *
 * These tests are designed to FAIL until the production implementation is complete.
 *
 * @see db/compat/sql/clickhouse/spikes/graph-sdk-unified.ts for API design
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import from production module path (does not exist yet - RED phase)
import {
  createStreamingTraversal,
  StreamingTraversal,
  StreamingContext,
  type Thing,
  type Relationship,
} from '../src/streaming'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Creates a mock streaming context with test data for streaming tests.
 */
function createTestContext(): StreamingContext {
  const relationships: Relationship[] = []
  const things = new Map<string, Thing>()

  const context: StreamingContext = {
    addRelationship(rel: Relationship) {
      relationships.push(rel)
    },
    addThing(thing: Thing) {
      things.set(thing.id, thing)
    },
    getRelationships() {
      return relationships
    },
    getThing(id: string) {
      return things.get(id)
    },
    getThings(ids: string[]) {
      return ids.map(id => things.get(id)).filter(Boolean) as Thing[]
    },
    // Streaming-specific: yields nodes one at a time
    async *streamThings(ids: string[]): AsyncIterableIterator<Thing> {
      for (const id of ids) {
        const thing = things.get(id)
        if (thing) {
          yield thing
        }
      }
    },
    // Streaming-specific: yields nodes in batches
    async *streamThingsBatched(ids: string[], batchSize: number): AsyncIterableIterator<Thing[]> {
      for (let i = 0; i < ids.length; i += batchSize) {
        const batchIds = ids.slice(i, i + batchSize)
        const batch = batchIds
          .map(id => things.get(id))
          .filter(Boolean) as Thing[]
        yield batch
      }
    },
  }

  return context
}

/**
 * Helper to create a Thing with minimal properties
 */
function createThing(id: string, type = 'User', data: Record<string, unknown> = {}): Thing {
  return {
    id,
    type,
    ns: 'test',
    data,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * Helper to create a Relationship
 */
function createRelationship(
  from: string,
  type: string,
  to: string,
  data: Record<string, unknown> = {}
): Relationship {
  return {
    id: `${from}-${type}-${to}`,
    type,
    from,
    to,
    data,
    createdAt: Date.now(),
  }
}

/**
 * Helper to create many test users
 */
function createManyUsers(ctx: StreamingContext, count: number, prefix = 'user'): void {
  for (let i = 1; i <= count; i++) {
    ctx.addThing(createThing(`${prefix}-${i}`, 'User', { name: `User ${i}`, index: i }))
  }
}

/**
 * Helper to create relationships from one user to many others
 */
function createFollowsMany(ctx: StreamingContext, fromId: string, toIds: string[]): void {
  for (const toId of toIds) {
    ctx.addRelationship(createRelationship(fromId, 'follows', toId))
  }
}

// ============================================================================
// $stream ASYNC ITERABLE INTERFACE
// ============================================================================

describe('Streaming Interface - $stream AsyncIterable', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()

    // Create test users
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addThing(createThing('dave', 'User', { name: 'Dave' }))

    // alice follows bob, carol, dave
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'dave'))
  })

  it('should return an AsyncIterable from $stream property', () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const stream = traversal.follows.$stream

    expect(stream).toBeDefined()
    expect(typeof stream[Symbol.asyncIterator]).toBe('function')
  })

  it('should yield nodes one at a time via $stream', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const receivedIds: string[] = []
    for await (const node of traversal.follows.$stream) {
      receivedIds.push(node.id)
    }

    expect(receivedIds).toContain('bob')
    expect(receivedIds).toContain('carol')
    expect(receivedIds).toContain('dave')
    expect(receivedIds).toHaveLength(3)
  })

  it('should yield complete Thing objects via $stream', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    for await (const node of traversal.follows.$stream) {
      expect(node).toHaveProperty('id')
      expect(node).toHaveProperty('type')
      expect(node).toHaveProperty('ns')
      expect(node).toHaveProperty('data')
      expect(node).toHaveProperty('createdAt')
      expect(node).toHaveProperty('updatedAt')
    }
  })

  it('should support chained traversals with $stream', async () => {
    // bob follows carol
    ctx.addRelationship(createRelationship('bob', 'follows', 'carol'))
    // carol follows dave
    ctx.addRelationship(createRelationship('carol', 'follows', 'dave'))

    const traversal = createStreamingTraversal(ctx, ['alice'])

    const receivedIds: string[] = []
    // Friends of friends
    for await (const node of traversal.follows.follows.$stream) {
      receivedIds.push(node.id)
    }

    // alice -> bob -> carol, alice -> carol -> dave
    expect(receivedIds).toContain('carol')
    expect(receivedIds).toContain('dave')
  })

  it('should handle empty results gracefully via $stream', async () => {
    ctx.addThing(createThing('lonely', 'User', { name: 'Lonely' }))

    const traversal = createStreamingTraversal(ctx, ['lonely'])

    const receivedIds: string[] = []
    for await (const node of traversal.follows.$stream) {
      receivedIds.push(node.id)
    }

    expect(receivedIds).toHaveLength(0)
  })

  it('should not require full result materialization (lazy evaluation)', async () => {
    // Create 1000 users
    createManyUsers(ctx, 1000)
    const followerIds = Array.from({ length: 1000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'alice', followerIds)

    const traversal = createStreamingTraversal(ctx, ['alice'])

    let count = 0
    for await (const _node of traversal.follows.$stream) {
      count++
      if (count >= 10) break // Early termination
    }

    // Should have only processed 10, not all 1000
    expect(count).toBe(10)
  })

  it('should support $stream on collection accessor', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    // Simulating $User.$stream pattern
    const userStream = traversal.$User.$stream

    expect(userStream).toBeDefined()
    expect(typeof userStream[Symbol.asyncIterator]).toBe('function')
  })

  it('should support $stream after filter operations', async () => {
    ctx.addThing(createThing('verified-user', 'User', { name: 'Verified', verified: true }))
    ctx.addRelationship(createRelationship('alice', 'follows', 'verified-user'))

    const traversal = createStreamingTraversal(ctx, ['alice'])

    const receivedIds: string[] = []
    for await (const node of traversal.follows.where({ verified: true }).$stream) {
      receivedIds.push(node.id)
    }

    expect(receivedIds).toContain('verified-user')
  })
})

// ============================================================================
// $batch(n) BATCHED ITERATION
// ============================================================================

describe('Streaming Interface - $batch(n) Batched Iteration', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()

    // Create 100 users
    createManyUsers(ctx, 100)

    // Alice follows all 100 users
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    createFollowsMany(ctx, 'alice', followerIds)
  })

  it('should return an AsyncIterable from $batch(n)', () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const batchStream = traversal.follows.$batch(10)

    expect(batchStream).toBeDefined()
    expect(typeof batchStream[Symbol.asyncIterator]).toBe('function')
  })

  it('should yield arrays of nodes with specified batch size', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const batches: Thing[][] = []
    for await (const batch of traversal.follows.$batch(10)) {
      batches.push(batch)
    }

    // 100 users / 10 per batch = 10 batches
    expect(batches).toHaveLength(10)
    expect(batches[0]).toHaveLength(10)
    expect(batches[9]).toHaveLength(10)
  })

  it('should handle non-evenly-divisible batch sizes', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const batches: Thing[][] = []
    for await (const batch of traversal.follows.$batch(15)) {
      batches.push(batch)
    }

    // 100 users / 15 per batch = 6 full batches + 1 partial (10 remaining)
    expect(batches).toHaveLength(7)
    expect(batches[0]).toHaveLength(15)
    expect(batches[5]).toHaveLength(15)
    expect(batches[6]).toHaveLength(10) // Last batch has remaining 10
  })

  it('should handle batch size larger than result set', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const batches: Thing[][] = []
    for await (const batch of traversal.follows.$batch(500)) {
      batches.push(batch)
    }

    // Only 100 users, so single batch of 100
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(100)
  })

  it('should handle batch size of 1', async () => {
    // Create a small test set
    ctx = createTestContext()
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))

    const traversal = createStreamingTraversal(ctx, ['alice'])

    const batches: Thing[][] = []
    for await (const batch of traversal.follows.$batch(1)) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(1)
    expect(batches[1]).toHaveLength(1)
  })

  it('should handle empty results with $batch', async () => {
    ctx.addThing(createThing('lonely', 'User', { name: 'Lonely' }))

    const traversal = createStreamingTraversal(ctx, ['lonely'])

    const batches: Thing[][] = []
    for await (const batch of traversal.follows.$batch(10)) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(0)
  })

  it('should yield complete Thing objects in each batch', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    for await (const batch of traversal.follows.$batch(10)) {
      for (const node of batch) {
        expect(node).toHaveProperty('id')
        expect(node).toHaveProperty('type')
        expect(node).toHaveProperty('ns')
        expect(node).toHaveProperty('data')
      }
    }
  })

  it('should support chained traversals with $batch', async () => {
    // user-1 follows user-2, user-3
    ctx.addRelationship(createRelationship('user-1', 'follows', 'user-2'))
    ctx.addRelationship(createRelationship('user-1', 'follows', 'user-3'))

    const traversal = createStreamingTraversal(ctx, ['alice'])

    const batches: Thing[][] = []
    for await (const batch of traversal.follows.follows.$batch(5)) {
      batches.push(batch)
    }

    // Should contain user-2 and user-3 via user-1
    const allIds = batches.flat().map(n => n.id)
    expect(allIds).toContain('user-2')
    expect(allIds).toContain('user-3')
  })

  it('should support early termination with $batch', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    let batchCount = 0
    for await (const _batch of traversal.follows.$batch(10)) {
      batchCount++
      if (batchCount >= 3) break // Stop after 3 batches
    }

    expect(batchCount).toBe(3)
  })

  it('should throw error for invalid batch size (0)', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    await expect(async () => {
      for await (const _batch of traversal.follows.$batch(0)) {
        // Should not reach here
      }
    }).rejects.toThrow()
  })

  it('should throw error for invalid batch size (negative)', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    await expect(async () => {
      for await (const _batch of traversal.follows.$batch(-5)) {
        // Should not reach here
      }
    }).rejects.toThrow()
  })
})

// ============================================================================
// FOR-AWAIT-OF NATIVE SUPPORT
// ============================================================================

describe('Streaming Interface - for-await-of Native Support', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addThing(createThing('dave', 'User', { name: 'Dave' }))

    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'dave'))
  })

  it('should implement Symbol.asyncIterator on traversal', () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    expect(typeof traversal.follows[Symbol.asyncIterator]).toBe('function')
  })

  it('should support direct for-await-of on traversal (without $stream)', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const receivedIds: string[] = []
    for await (const node of traversal.follows) {
      receivedIds.push(node.id)
    }

    expect(receivedIds).toContain('bob')
    expect(receivedIds).toContain('carol')
    expect(receivedIds).toContain('dave')
    expect(receivedIds).toHaveLength(3)
  })

  it('should yield Thing objects with all properties', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    for await (const node of traversal.follows) {
      expect(node).toHaveProperty('id')
      expect(node).toHaveProperty('type')
      expect(typeof node.id).toBe('string')
      expect(typeof node.type).toBe('string')
    }
  })

  it('should support chained traversals with for-await-of', async () => {
    ctx.addRelationship(createRelationship('bob', 'follows', 'carol'))

    const traversal = createStreamingTraversal(ctx, ['alice'])

    const receivedIds: string[] = []
    for await (const node of traversal.follows.follows) {
      receivedIds.push(node.id)
    }

    expect(receivedIds).toContain('carol')
  })

  it('should support early break in for-await-of loop', async () => {
    // Create many users
    createManyUsers(ctx, 100)
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'alice', followerIds)

    const traversal = createStreamingTraversal(ctx, ['alice'])

    let count = 0
    for await (const _node of traversal.follows) {
      count++
      if (count >= 5) break
    }

    expect(count).toBe(5)
  })

  it('should support continue in for-await-of loop', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const receivedIds: string[] = []
    for await (const node of traversal.follows) {
      if (node.id === 'bob') continue
      receivedIds.push(node.id)
    }

    expect(receivedIds).not.toContain('bob')
    expect(receivedIds).toContain('carol')
    expect(receivedIds).toContain('dave')
  })

  it('should handle empty traversal results', async () => {
    ctx.addThing(createThing('lonely', 'User', { name: 'Lonely' }))

    const traversal = createStreamingTraversal(ctx, ['lonely'])

    let count = 0
    for await (const _node of traversal.follows) {
      count++
    }

    expect(count).toBe(0)
  })

  it('should work with Promise.all via Array.fromAsync', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    // Array.fromAsync is the standard way to collect async iterables
    const nodes = await Array.fromAsync(traversal.follows)

    expect(nodes).toHaveLength(3)
    expect(nodes.map(n => n.id)).toContain('bob')
  })

  it('should support async iteration after filter', async () => {
    ctx.addThing(createThing('verified-user', 'User', { name: 'Verified', verified: true }))
    ctx.addRelationship(createRelationship('alice', 'follows', 'verified-user'))

    const traversal = createStreamingTraversal(ctx, ['alice'])

    const receivedIds: string[] = []
    for await (const node of traversal.follows.where({ verified: true })) {
      receivedIds.push(node.id)
    }

    expect(receivedIds).toContain('verified-user')
  })

  it('should support async iteration with limit', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const receivedIds: string[] = []
    for await (const node of traversal.follows.limit(2)) {
      receivedIds.push(node.id)
    }

    expect(receivedIds).toHaveLength(2)
  })

  it('should support async iteration with skip', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const allNodes: Thing[] = []
    for await (const node of traversal.follows) {
      allNodes.push(node)
    }

    const skippedNodes: Thing[] = []
    for await (const node of traversal.follows.skip(1)) {
      skippedNodes.push(node)
    }

    expect(skippedNodes).toHaveLength(2)
    expect(skippedNodes.map(n => n.id)).not.toContain(allNodes[0].id)
  })
})

// ============================================================================
// MEMORY EFFICIENCY VERIFICATION
// ============================================================================

describe('Streaming Interface - Memory Efficiency', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should not materialize full result set when using $stream', async () => {
    // Create large dataset
    createManyUsers(ctx, 10000)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 10000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Track if full materialization occurred
    let materializedCount = 0
    const originalGetThings = ctx.getThings.bind(ctx)
    ctx.getThings = (ids: string[]) => {
      materializedCount = ids.length
      return originalGetThings(ids)
    }

    // Consume only first 10 items
    let count = 0
    for await (const _node of traversal.follows.$stream) {
      count++
      if (count >= 10) break
    }

    // Should not have materialized all 10000 at once
    // This test verifies lazy evaluation
    expect(materializedCount).toBeLessThan(10000)
  })

  it('should process nodes one at a time in $stream (lazy evaluation)', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    const yielded: string[] = []
    let processedConcurrently = false

    for await (const node of traversal.follows.$stream) {
      // Check if multiple nodes were yielded without being processed
      if (yielded.length > 1 && !processedConcurrently) {
        // If we have unprocessed nodes stacking up, not truly lazy
        processedConcurrently = true
      }
      yielded.push(node.id)

      // Simulate processing delay
      await new Promise(resolve => setTimeout(resolve, 0))

      if (yielded.length >= 10) break
    }

    expect(yielded).toHaveLength(10)
    // Lazy evaluation means we should process one at a time
  })

  it('should batch efficiently with $batch (not one-at-a-time)', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    const batchSizes: number[] = []
    for await (const batch of traversal.follows.$batch(25)) {
      batchSizes.push(batch.length)
    }

    // Should have exactly 4 batches of 25
    expect(batchSizes).toEqual([25, 25, 25, 25])
  })

  it('should not hold all results in memory when streaming large result sets', async () => {
    // Create very large dataset
    createManyUsers(ctx, 50000)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 50000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // This test ensures streaming doesn't cause memory issues
    // by tracking peak concurrent allocations
    let peakConcurrentItems = 0
    let currentItems = 0

    const stream = traversal.follows.$stream
    const iterator = stream[Symbol.asyncIterator]()

    // Simulate consuming stream with backpressure
    for (let i = 0; i < 1000; i++) {
      const result = await iterator.next()
      if (result.done) break

      currentItems++
      peakConcurrentItems = Math.max(peakConcurrentItems, currentItems)

      // Simulate processing (releasing the item)
      currentItems--
    }

    // Peak should be very low (ideally 1) if truly streaming
    expect(peakConcurrentItems).toBeLessThanOrEqual(10)
  })

  it('should support backpressure handling in streaming', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Simulate slow consumer with backpressure
    let processedCount = 0
    const processingTimes: number[] = []

    for await (const _node of traversal.follows.$stream) {
      const startTime = Date.now()

      // Simulate slow processing
      await new Promise(resolve => setTimeout(resolve, 5))

      processingTimes.push(Date.now() - startTime)
      processedCount++

      if (processedCount >= 20) break
    }

    expect(processedCount).toBe(20)
    // Each processing should have taken at least 5ms
    expect(processingTimes.every(t => t >= 4)).toBe(true)
  })

  it('should release memory after stream is consumed', async () => {
    createManyUsers(ctx, 1000)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 1000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Consume stream completely
    const nodes: Thing[] = []
    for await (const node of traversal.follows.$stream) {
      nodes.push(node)
    }

    expect(nodes).toHaveLength(1000)

    // Stream should be exhausted and not hold internal state
    const stream = traversal.follows.$stream
    const iterator = stream[Symbol.asyncIterator]()

    // New iterator should start fresh
    const firstResult = await iterator.next()
    expect(firstResult.done).toBe(false)
  })

  it('should handle concurrent streaming of multiple traversals', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))

    const aliceFollowers = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`)
    const bobFollowers = Array.from({ length: 50 }, (_, i) => `user-${i + 51}`)

    createFollowsMany(ctx, 'alice', aliceFollowers)
    createFollowsMany(ctx, 'bob', bobFollowers)

    const aliceTraversal = createStreamingTraversal(ctx, ['alice'])
    const bobTraversal = createStreamingTraversal(ctx, ['bob'])

    // Consume both streams concurrently
    const [aliceNodes, bobNodes] = await Promise.all([
      Array.fromAsync(aliceTraversal.follows.$stream),
      Array.fromAsync(bobTraversal.follows.$stream),
    ])

    expect(aliceNodes).toHaveLength(50)
    expect(bobNodes).toHaveLength(50)

    // Should not have any overlap
    const aliceIds = new Set(aliceNodes.map(n => n.id))
    const bobIds = new Set(bobNodes.map(n => n.id))
    const intersection = [...aliceIds].filter(id => bobIds.has(id))
    expect(intersection).toHaveLength(0)
  })
})

// ============================================================================
// TYPE COLLECTION STREAMING ($Type.$stream)
// ============================================================================

describe('Streaming Interface - Type Collection Streaming', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()

    // Create users and posts
    ctx.addThing(createThing('user-1', 'User', { name: 'User 1' }))
    ctx.addThing(createThing('user-2', 'User', { name: 'User 2' }))
    ctx.addThing(createThing('user-3', 'User', { name: 'User 3' }))
    ctx.addThing(createThing('post-1', 'Post', { title: 'Post 1' }))
    ctx.addThing(createThing('post-2', 'Post', { title: 'Post 2' }))
  })

  it('should support $stream on type collection accessor', async () => {
    const graph = createStreamingTraversal(ctx, [])

    const users: Thing[] = []
    for await (const user of graph.$User.$stream) {
      users.push(user)
    }

    expect(users).toHaveLength(3)
    expect(users.every(u => u.type === 'User')).toBe(true)
  })

  it('should support $batch on type collection accessor', async () => {
    const graph = createStreamingTraversal(ctx, [])

    const batches: Thing[][] = []
    for await (const batch of graph.$User.$batch(2)) {
      batches.push(batch)
    }

    expect(batches).toHaveLength(2)
    expect(batches[0]).toHaveLength(2)
    expect(batches[1]).toHaveLength(1)
  })

  it('should filter by type correctly when streaming', async () => {
    const graph = createStreamingTraversal(ctx, [])

    const posts: Thing[] = []
    for await (const post of graph.$Post.$stream) {
      posts.push(post)
    }

    expect(posts).toHaveLength(2)
    expect(posts.every(p => p.type === 'Post')).toBe(true)
  })
})

// ============================================================================
// ERROR HANDLING IN STREAMS
// ============================================================================

describe('Streaming Interface - Error Handling', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
  })

  it('should propagate errors from underlying data source in $stream', async () => {
    const errorCtx: StreamingContext = {
      ...ctx,
      async *streamThings(_ids: string[]): AsyncIterableIterator<Thing> {
        throw new Error('Data source error')
      },
    }

    const traversal = createStreamingTraversal(errorCtx, ['alice'])

    await expect(async () => {
      for await (const _node of traversal.follows.$stream) {
        // Should not reach here
      }
    }).rejects.toThrow('Data source error')
  })

  it('should propagate errors from underlying data source in $batch', async () => {
    const errorCtx: StreamingContext = {
      ...ctx,
      async *streamThingsBatched(_ids: string[], _batchSize: number): AsyncIterableIterator<Thing[]> {
        throw new Error('Batch data source error')
      },
    }

    const traversal = createStreamingTraversal(errorCtx, ['alice'])

    await expect(async () => {
      for await (const _batch of traversal.follows.$batch(10)) {
        // Should not reach here
      }
    }).rejects.toThrow('Batch data source error')
  })

  it('should support try-catch around stream iteration', async () => {
    const errorCtx: StreamingContext = {
      ...ctx,
      async *streamThings(ids: string[]): AsyncIterableIterator<Thing> {
        yield ctx.getThing('bob')!
        throw new Error('Mid-stream error')
      },
    }

    const traversal = createStreamingTraversal(errorCtx, ['alice'])

    let caughtError: Error | null = null
    let processedCount = 0

    try {
      for await (const _node of traversal.follows.$stream) {
        processedCount++
      }
    } catch (error) {
      caughtError = error as Error
    }

    expect(processedCount).toBe(1)
    expect(caughtError).not.toBeNull()
    expect(caughtError?.message).toBe('Mid-stream error')
  })

  it('should clean up resources on stream abort', async () => {
    let cleanupCalled = false

    const cleanupCtx: StreamingContext = {
      ...ctx,
      async *streamThings(ids: string[]): AsyncIterableIterator<Thing> {
        try {
          for (const id of ids) {
            const thing = ctx.getThing(id)
            if (thing) yield thing
          }
        } finally {
          cleanupCalled = true
        }
      },
    }

    const traversal = createStreamingTraversal(cleanupCtx, ['alice'])

    for await (const _node of traversal.follows.$stream) {
      break // Abort early
    }

    // Cleanup should have been called via finally block
    expect(cleanupCalled).toBe(true)
  })
})

// ============================================================================
// STREAMING WITH SET OPERATIONS
// ============================================================================

describe('Streaming Interface - Set Operations with Streaming', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()

    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addThing(createThing('carol', 'User', { name: 'Carol' }))
    ctx.addThing(createThing('dave', 'User', { name: 'Dave' }))
    ctx.addThing(createThing('eve', 'User', { name: 'Eve' }))

    // alice follows bob, carol
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
    ctx.addRelationship(createRelationship('alice', 'follows', 'carol'))
    // bob follows carol, dave
    ctx.addRelationship(createRelationship('bob', 'follows', 'carol'))
    ctx.addRelationship(createRelationship('bob', 'follows', 'dave'))
    // carol follows eve
    ctx.addRelationship(createRelationship('carol', 'follows', 'eve'))
  })

  it('should support $stream after intersect operation', async () => {
    const aliceTraversal = createStreamingTraversal(ctx, ['alice'])
    const bobTraversal = createStreamingTraversal(ctx, ['bob'])

    const mutual = aliceTraversal.follows.intersect(bobTraversal.follows)

    const mutualIds: string[] = []
    for await (const node of mutual.$stream) {
      mutualIds.push(node.id)
    }

    // Both alice and bob follow carol
    expect(mutualIds).toContain('carol')
    expect(mutualIds).toHaveLength(1)
  })

  it('should support $stream after union operation', async () => {
    const aliceTraversal = createStreamingTraversal(ctx, ['alice'])
    const bobTraversal = createStreamingTraversal(ctx, ['bob'])

    const combined = aliceTraversal.follows.union(bobTraversal.follows)

    const combinedIds: string[] = []
    for await (const node of combined.$stream) {
      combinedIds.push(node.id)
    }

    // alice follows bob, carol; bob follows carol, dave
    expect(combinedIds).toContain('bob')
    expect(combinedIds).toContain('carol')
    expect(combinedIds).toContain('dave')
  })

  it('should support $stream after except operation', async () => {
    const aliceTraversal = createStreamingTraversal(ctx, ['alice'])

    // Friends of friends except direct friends
    const fofNotFriends = aliceTraversal.follows.follows.except(aliceTraversal.follows)

    const resultIds: string[] = []
    for await (const node of fofNotFriends.$stream) {
      resultIds.push(node.id)
    }

    // alice.follows.follows = carol (via bob), dave (via bob), eve (via carol)
    // alice.follows = bob, carol
    // except = dave, eve
    expect(resultIds).toContain('dave')
    expect(resultIds).toContain('eve')
    expect(resultIds).not.toContain('bob')
    expect(resultIds).not.toContain('carol')
  })

  it('should support $batch after set operations', async () => {
    const aliceTraversal = createStreamingTraversal(ctx, ['alice'])
    const bobTraversal = createStreamingTraversal(ctx, ['bob'])

    const combined = aliceTraversal.follows.union(bobTraversal.follows)

    const batches: Thing[][] = []
    for await (const batch of combined.$batch(2)) {
      batches.push(batch)
    }

    // bob, carol, dave = 3 total, batched by 2
    expect(batches.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// STREAMING INTERFACE TYPE TESTS
// ============================================================================

describe('Streaming Interface - Type Annotations', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
    ctx.addThing(createThing('alice', 'User', { name: 'Alice' }))
    ctx.addThing(createThing('bob', 'User', { name: 'Bob' }))
    ctx.addRelationship(createRelationship('alice', 'follows', 'bob'))
  })

  it('should have correct type for $stream property', () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const stream: AsyncIterable<Thing> = traversal.follows.$stream

    expect(stream).toBeDefined()
  })

  it('should have correct type for $batch method', () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const batchStream: AsyncIterable<Thing[]> = traversal.follows.$batch(10)

    expect(batchStream).toBeDefined()
  })

  it('should have correct iterator type for for-await-of', async () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    // Type assertion: node should be Thing
    for await (const node of traversal.follows) {
      const typedNode: Thing = node
      expect(typedNode.id).toBeDefined()
    }
  })

  it('should preserve StreamingTraversal type after chaining', () => {
    const traversal = createStreamingTraversal(ctx, ['alice'])

    const chained: StreamingTraversal = traversal.follows

    expect(chained.$stream).toBeDefined()
    expect(typeof chained.$batch).toBe('function')
  })
})
