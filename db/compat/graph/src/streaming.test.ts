/**
 * Streaming Interface - TDD RED Phase Tests (Issue dotdo-r22hl)
 *
 * These tests cover advanced streaming features that are NOT YET IMPLEMENTED:
 * - True lazy evaluation (no upfront ID materialization)
 * - Backpressure handling with configurable memory limits
 * - Cursor-based resumption for long-running streams
 * - Stream pause/resume capabilities
 * - Memory-bounded batching
 * - Progress tracking and statistics
 *
 * All tests in this file are expected to FAIL until the implementation is complete.
 *
 * @see db/compat/sql/clickhouse/spikes/graph-sdk-unified.ts for API design
 * @module db/compat/graph/src/streaming.test
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  createStreamingTraversal,
  type StreamingContext,
  type Thing,
  type Relationship,
} from './streaming'

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
    async *streamThings(ids: string[]): AsyncIterableIterator<Thing> {
      for (const id of ids) {
        const thing = things.get(id)
        if (thing) {
          yield thing
        }
      }
    },
    async *streamThingsBatched(ids: string[], batchSize: number): AsyncIterableIterator<Thing[]> {
      for (let i = 0; i < ids.length; i += batchSize) {
        const batchIds = ids.slice(i, i + batchSize)
        const batch = batchIds
          .map(id => things.get(id))
          .filter(Boolean) as Thing[]
        yield batch
      }
    },
    getThingsByType(type: string): Thing[] {
      return [...things.values()].filter(thing => thing.type === type)
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
// 1. TRUE LAZY EVALUATION (NO UPFRONT ID MATERIALIZATION)
// ============================================================================

describe('Streaming Interface - True Lazy Evaluation', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should NOT compute all IDs before starting to yield (lazy traversal)', async () => {
    // Create a large dataset
    createManyUsers(ctx, 10000)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 10000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Track when ID computation happens
    let idsComputedAt: number | null = null
    let firstYieldAt: number | null = null
    let idCount = 0

    // Wrap the context's streamThings to track timing
    const originalStreamThings = ctx.streamThings.bind(ctx)
    ctx.streamThings = async function* (ids: string[]) {
      idsComputedAt = Date.now()
      idCount = ids.length
      yield* originalStreamThings(ids)
    }

    const stream = traversal.follows.$stream
    let yieldCount = 0

    for await (const _node of stream) {
      if (firstYieldAt === null) {
        firstYieldAt = Date.now()
      }
      yieldCount++
      if (yieldCount >= 10) break // Stop early
    }

    // In a truly lazy implementation, we should NOT have computed all 10000 IDs
    // before starting to yield. The current implementation does compute all IDs first.
    //
    // This test SHOULD FAIL with the current implementation because:
    // - idCount will be 10000 (all IDs computed)
    // - We only consumed 10 nodes
    //
    // After fixing, idCount should be much smaller (e.g., <= 100) or
    // idsComputedAt should be null/undefined (streaming without ID collection)
    expect(idCount).toBeLessThan(100) // Should not precompute all IDs
  })

  it('should yield nodes as they are discovered (incremental traversal)', async () => {
    // Create a deep chain: hub -> A -> B -> C -> D -> ... (100 levels)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    let prevId = 'hub'
    for (let i = 1; i <= 100; i++) {
      const id = `chain-${i}`
      ctx.addThing(createThing(id, 'User', { name: `Chain ${i}`, depth: i }))
      ctx.addRelationship(createRelationship(prevId, 'next', id))
      prevId = id
    }

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Stream with depth traversal
    const yieldedDepths: number[] = []
    let yieldCount = 0

    // A truly lazy implementation should yield nodes incrementally
    // as they're discovered during BFS/DFS traversal
    for await (const node of traversal.next.$stream) {
      yieldedDepths.push(node.data.depth as number)
      yieldCount++
      if (yieldCount >= 5) break
    }

    // In incremental traversal, we should see nodes yielded in discovery order
    // without waiting for the full traversal to complete
    expect(yieldedDepths.length).toBe(5)
    // Depths should be sequential if yielding incrementally
    expect(yieldedDepths).toEqual([1, 2, 3, 4, 5])
  })

  it('should support infinite streams (generator-based)', async () => {
    // Create a context that can generate nodes infinitely
    let generatedCount = 0

    const infiniteCtx: StreamingContext = {
      ...ctx,
      async *streamThings(_ids: string[]): AsyncIterableIterator<Thing> {
        // Infinite generator
        let i = 1
        while (true) {
          generatedCount = i
          yield createThing(`infinite-${i}`, 'InfiniteUser', { index: i })
          i++
        }
      },
    }

    // Add a single hub node and relationships
    infiniteCtx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    infiniteCtx.addRelationship(createRelationship('hub', 'generates', 'infinite-start'))

    const traversal = createStreamingTraversal(infiniteCtx, ['hub'])

    // Should be able to consume partial results from infinite stream
    let consumed = 0
    for await (const _node of traversal.generates.$stream) {
      consumed++
      if (consumed >= 100) break
    }

    // Should only have generated what we consumed (not infinite!)
    expect(consumed).toBe(100)
    expect(generatedCount).toBeLessThanOrEqual(110) // Some buffer is OK
  })
})

// ============================================================================
// 2. BACKPRESSURE HANDLING WITH CONFIGURABLE MEMORY LIMITS
// ============================================================================

describe('Streaming Interface - Backpressure and Memory Limits', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should support configurable memory limits via $streamWithLimit', async () => {
    createManyUsers(ctx, 10000)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 10000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // New API: $streamWithLimit allows configuring memory bounds
    // @ts-expect-error - $streamWithLimit not implemented yet
    const stream = traversal.follows.$streamWithLimit({
      maxBufferSize: 100, // Max 100 items in memory at once
      highWaterMark: 80,  // Start backpressure at 80 items
      lowWaterMark: 20,   // Resume at 20 items
    })

    let maxConcurrent = 0
    let currentCount = 0
    const results: Thing[] = []

    for await (const node of stream) {
      currentCount++
      maxConcurrent = Math.max(maxConcurrent, currentCount)
      results.push(node)
      // Simulate slow processing
      await new Promise(r => setTimeout(r, 1))
      currentCount--

      if (results.length >= 500) break
    }

    // Memory limit should be respected
    expect(maxConcurrent).toBeLessThanOrEqual(100)
  })

  it('should pause producer when consumer is slow (backpressure signal)', async () => {
    createManyUsers(ctx, 1000)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 1000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    const produceTimes: number[] = []
    const consumeTimes: number[] = []

    // Track when items are produced vs consumed
    let produceCount = 0
    const wrappedStreamThings = ctx.streamThings.bind(ctx)
    ctx.streamThings = async function* (ids: string[]) {
      for await (const thing of wrappedStreamThings(ids)) {
        produceTimes.push(Date.now())
        produceCount++
        yield thing
        // Producer should slow down when consumer is slow
      }
    }

    const stream = traversal.follows.$stream
    let consumed = 0

    for await (const _node of stream) {
      consumeTimes.push(Date.now())
      consumed++

      // Slow consumer
      await new Promise(r => setTimeout(r, 10))

      if (consumed >= 50) break
    }

    // With backpressure, produce times should spread out to match consume times
    // Without backpressure, all produce times would be clustered at the start
    const produceSpan = produceTimes[produceTimes.length - 1] - produceTimes[0]
    const consumeSpan = consumeTimes[consumeTimes.length - 1] - consumeTimes[0]

    // Producer should NOT run far ahead of consumer
    // (with backpressure, they should be roughly synchronized)
    expect(produceSpan).toBeGreaterThan(consumeSpan * 0.5)
  })

  it('should expose backpressure state via getBackpressureStatus()', async () => {
    createManyUsers(ctx, 500)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 500 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $streamWithBackpressure not implemented yet
    const stream = traversal.follows.$streamWithBackpressure()

    let sawBackpressure = false
    const statuses: { buffered: number; isPaused: boolean }[] = []

    for await (const _node of stream) {
      // @ts-expect-error - getBackpressureStatus not implemented yet
      const status = stream.getBackpressureStatus()
      statuses.push(status)

      if (status.isPaused) {
        sawBackpressure = true
      }

      // Very slow consumer
      await new Promise(r => setTimeout(r, 20))

      if (statuses.length >= 100) break
    }

    // Should have seen some backpressure state
    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses[0]).toHaveProperty('buffered')
    expect(statuses[0]).toHaveProperty('isPaused')
  })

  it('should support pull-based streaming (demand-driven)', async () => {
    createManyUsers(ctx, 1000)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 1000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // New API: pull-based stream where consumer explicitly requests items
    // @ts-expect-error - $pull not implemented yet
    const pullStream = traversal.follows.$pull()

    // Request specific number of items
    // @ts-expect-error - request not implemented yet
    const batch1 = await pullStream.request(10)
    expect(batch1).toHaveLength(10)

    // Request more
    // @ts-expect-error - request not implemented yet
    const batch2 = await pullStream.request(20)
    expect(batch2).toHaveLength(20)

    // Check remaining
    // @ts-expect-error - remaining not implemented yet
    const remaining = await pullStream.remaining()
    expect(remaining).toBe(970) // 1000 - 10 - 20

    // Close without consuming all
    // @ts-expect-error - close not implemented yet
    await pullStream.close()
  })
})

// ============================================================================
// 3. CURSOR-BASED RESUMPTION
// ============================================================================

describe('Streaming Interface - Cursor-Based Resumption', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should support getCursor() during iteration', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    const stream = traversal.follows.$stream
    let cursor: string | undefined
    let consumed = 0
    const firstBatch: string[] = []

    for await (const node of stream) {
      firstBatch.push(node.id)
      consumed++

      if (consumed === 50) {
        // Get cursor at midpoint
        // @ts-expect-error - getCursor not implemented yet
        cursor = stream.getCursor()
        break
      }
    }

    expect(cursor).toBeDefined()
    expect(typeof cursor).toBe('string')
    expect(firstBatch).toHaveLength(50)
  })

  it('should resume from cursor with $streamFromCursor()', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // First iteration - get cursor at midpoint
    const stream1 = traversal.follows.$stream
    let cursor: string | undefined
    const firstBatch: string[] = []

    for await (const node of stream1) {
      firstBatch.push(node.id)
      if (firstBatch.length === 50) {
        // @ts-expect-error - getCursor not implemented yet
        cursor = stream1.getCursor()
        break
      }
    }

    // Resume from cursor
    // @ts-expect-error - $streamFromCursor not implemented yet
    const stream2 = traversal.follows.$streamFromCursor(cursor)
    const secondBatch: string[] = []

    for await (const node of stream2) {
      secondBatch.push(node.id)
    }

    // Should have exactly the remaining 50
    expect(secondBatch).toHaveLength(50)

    // No overlap between batches
    const overlap = firstBatch.filter(id => secondBatch.includes(id))
    expect(overlap).toHaveLength(0)

    // Together should cover all 100
    const combined = [...firstBatch, ...secondBatch]
    expect(new Set(combined).size).toBe(100)
  })

  it('should support serializable cursors for persistence', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    const stream = traversal.follows.$stream
    let cursor: string | undefined

    for await (const _node of stream) {
      // @ts-expect-error - getCursor not implemented yet
      cursor = stream.getCursor()
      break
    }

    // Cursor should be JSON-serializable for persistence
    const serialized = JSON.stringify({ cursor })
    const deserialized = JSON.parse(serialized)

    expect(deserialized.cursor).toBe(cursor)

    // Should be able to resume in a "new session"
    const newTraversal = createStreamingTraversal(ctx, ['hub'])
    // @ts-expect-error - $streamFromCursor not implemented yet
    const resumedStream = newTraversal.follows.$streamFromCursor(deserialized.cursor)

    let count = 0
    for await (const _node of resumedStream) {
      count++
    }

    // Should resume where we left off
    expect(count).toBe(99) // All but the first one
  })

  it('should support cursor expiration/validation', async () => {
    createManyUsers(ctx, 50)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Use an invalid/expired cursor
    const invalidCursor = 'invalid-cursor-12345'

    // @ts-expect-error - $streamFromCursor not implemented yet
    const stream = traversal.follows.$streamFromCursor(invalidCursor)

    await expect(async () => {
      for await (const _node of stream) {
        // Should throw on first iteration attempt
      }
    }).rejects.toThrow(/invalid|expired|cursor/i)
  })

  it('should support cursor with $batch as well', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $batchWithCursor not implemented yet
    const batchStream = traversal.follows.$batchWithCursor(10)

    let cursor: string | undefined
    let batchCount = 0
    const firstBatches: Thing[][] = []

    for await (const batch of batchStream) {
      firstBatches.push(batch)
      batchCount++
      if (batchCount === 3) {
        // @ts-expect-error - getCursor not implemented yet
        cursor = batchStream.getCursor()
        break
      }
    }

    // Should have consumed 3 batches of 10 = 30 items
    expect(firstBatches.flat()).toHaveLength(30)

    // Resume
    // @ts-expect-error - $batchFromCursor not implemented yet
    const resumedStream = traversal.follows.$batchFromCursor(10, cursor)
    const remainingBatches: Thing[][] = []

    for await (const batch of resumedStream) {
      remainingBatches.push(batch)
    }

    // Should have 7 more batches (70 items)
    expect(remainingBatches.flat()).toHaveLength(70)
  })
})

// ============================================================================
// 4. STREAM PAUSE/RESUME CAPABILITIES
// ============================================================================

describe('Streaming Interface - Pause/Resume', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should support explicit pause() and resume()', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $controllableStream not implemented yet
    const stream = traversal.follows.$controllableStream()

    const received: string[] = []
    let pausedAt: number | null = null
    let resumedAt: number | null = null

    // Start consuming in background
    const consumePromise = (async () => {
      for await (const node of stream) {
        received.push(node.id)
        if (received.length >= 100) break
      }
    })()

    // Pause after some items
    await new Promise(r => setTimeout(r, 10))
    // @ts-expect-error - pause not implemented yet
    stream.pause()
    pausedAt = received.length

    // Wait while paused
    await new Promise(r => setTimeout(r, 50))
    const afterPause = received.length

    // Resume
    // @ts-expect-error - resume not implemented yet
    stream.resume()
    resumedAt = received.length

    await consumePromise

    // Should have paused (no new items while paused)
    expect(afterPause).toBe(pausedAt)
    // Should have resumed (got all items eventually)
    expect(received.length).toBe(100)
  })

  it('should support isPaused() status check', async () => {
    createManyUsers(ctx, 50)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $controllableStream not implemented yet
    const stream = traversal.follows.$controllableStream()

    // @ts-expect-error - isPaused not implemented yet
    expect(stream.isPaused()).toBe(false)

    // @ts-expect-error - pause not implemented yet
    stream.pause()
    // @ts-expect-error - isPaused not implemented yet
    expect(stream.isPaused()).toBe(true)

    // @ts-expect-error - resume not implemented yet
    stream.resume()
    // @ts-expect-error - isPaused not implemented yet
    expect(stream.isPaused()).toBe(false)
  })

  it('should support abort() to cancel stream entirely', async () => {
    createManyUsers(ctx, 1000)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 1000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $controllableStream not implemented yet
    const stream = traversal.follows.$controllableStream()

    const received: string[] = []
    let aborted = false

    const consumePromise = (async () => {
      try {
        for await (const node of stream) {
          received.push(node.id)
        }
      } catch (e) {
        if ((e as Error).message.includes('abort')) {
          aborted = true
        } else {
          throw e
        }
      }
    })()

    // Abort after some items
    await new Promise(r => setTimeout(r, 10))
    // @ts-expect-error - abort not implemented yet
    stream.abort()

    await consumePromise

    // Should have aborted
    expect(aborted).toBe(true)
    expect(received.length).toBeLessThan(1000)
  })

  it('should support AbortController integration', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    const controller = new AbortController()

    // @ts-expect-error - $streamWithSignal not implemented yet
    const stream = traversal.follows.$streamWithSignal(controller.signal)

    const received: string[] = []

    const consumePromise = (async () => {
      for await (const node of stream) {
        received.push(node.id)
        if (received.length >= 50) {
          controller.abort()
        }
      }
    })()

    await expect(consumePromise).rejects.toThrow(/abort/i)
    expect(received.length).toBe(50)
  })
})

// ============================================================================
// 5. MEMORY-BOUNDED BATCHING
// ============================================================================

describe('Streaming Interface - Memory-Bounded Batching', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should support $batchByMemory for size-based batching', async () => {
    // Create users with varying data sizes
    for (let i = 1; i <= 100; i++) {
      const dataSize = i * 100 // Increasing payload size
      ctx.addThing(createThing(`user-${i}`, 'User', {
        name: `User ${i}`,
        payload: 'x'.repeat(dataSize),
      }))
    }
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Batch by approximate memory size (10KB per batch)
    // @ts-expect-error - $batchByMemory not implemented yet
    const stream = traversal.follows.$batchByMemory(10 * 1024)

    const batchSizes: number[] = []
    for await (const batch of stream) {
      batchSizes.push(batch.length)
    }

    // Batches should vary in size based on payload
    // Smaller payloads = more items per batch
    // Larger payloads = fewer items per batch
    expect(batchSizes.length).toBeGreaterThan(1)
    expect(batchSizes[0]).toBeGreaterThan(batchSizes[batchSizes.length - 1])
  })

  it('should support custom size estimator function', async () => {
    createManyUsers(ctx, 50)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Custom estimator that considers specific fields
    const customEstimator = (thing: Thing): number => {
      const jsonStr = JSON.stringify(thing)
      return jsonStr.length * 2 // UTF-16 estimate
    }

    // @ts-expect-error - $batchByMemory not implemented yet
    const stream = traversal.follows.$batchByMemory(1000, { estimator: customEstimator })

    let batchCount = 0
    for await (const _batch of stream) {
      batchCount++
    }

    expect(batchCount).toBeGreaterThan(0)
  })

  it('should enforce maximum batch count limit', async () => {
    createManyUsers(ctx, 1000)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 1000 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Even with memory-based batching, enforce max items per batch
    // @ts-expect-error - $batchByMemory not implemented yet
    const stream = traversal.follows.$batchByMemory(1024 * 1024, { maxItems: 50 })

    for await (const batch of stream) {
      expect(batch.length).toBeLessThanOrEqual(50)
    }
  })

  it('should report batch memory statistics', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $batchByMemory not implemented yet
    const stream = traversal.follows.$batchByMemory(5000)

    // @ts-expect-error - getMemoryStats not implemented yet
    const stats = await stream.getMemoryStats()

    expect(stats).toHaveProperty('totalEstimatedBytes')
    expect(stats).toHaveProperty('peakBatchBytes')
    expect(stats).toHaveProperty('averageBatchBytes')
    expect(stats).toHaveProperty('batchCount')
  })
})

// ============================================================================
// 6. PROGRESS TRACKING AND STATISTICS
// ============================================================================

describe('Streaming Interface - Progress Tracking', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should support getProgress() during streaming', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $streamWithProgress not implemented yet
    const stream = traversal.follows.$streamWithProgress()

    const progressSnapshots: {
      yielded: number
      total: number | null
      percentage: number | null
    }[] = []

    for await (const _node of stream) {
      // @ts-expect-error - getProgress not implemented yet
      const progress = stream.getProgress()
      progressSnapshots.push(progress)
    }

    // Should have progress information
    expect(progressSnapshots.length).toBe(100)

    // First snapshot
    expect(progressSnapshots[0].yielded).toBe(1)

    // Last snapshot
    expect(progressSnapshots[99].yielded).toBe(100)
    expect(progressSnapshots[99].percentage).toBe(100)
  })

  it('should emit progress events', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    const progressEvents: { yielded: number; percentage: number }[] = []

    // @ts-expect-error - $streamWithProgress not implemented yet
    const stream = traversal.follows.$streamWithProgress({
      onProgress: (progress: { yielded: number; percentage: number }) => {
        progressEvents.push(progress)
      },
      interval: 10, // Emit every 10 items
    })

    for await (const _node of stream) {
      // consume
    }

    // Should have received progress events at intervals
    expect(progressEvents.length).toBe(10) // 100 items / 10 interval
    expect(progressEvents[0].yielded).toBe(10)
    expect(progressEvents[9].yielded).toBe(100)
  })

  it('should track timing statistics', async () => {
    createManyUsers(ctx, 50)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $streamWithProgress not implemented yet
    const stream = traversal.follows.$streamWithProgress()

    for await (const _node of stream) {
      // Simulate processing time
      await new Promise(r => setTimeout(r, 1))
    }

    // @ts-expect-error - getStats not implemented yet
    const stats = stream.getStats()

    expect(stats).toHaveProperty('totalItems')
    expect(stats).toHaveProperty('startTime')
    expect(stats).toHaveProperty('endTime')
    expect(stats).toHaveProperty('elapsedMs')
    expect(stats).toHaveProperty('itemsPerSecond')
    expect(stats).toHaveProperty('averageItemMs')

    expect(stats.totalItems).toBe(50)
    expect(stats.elapsedMs).toBeGreaterThan(50) // At least 1ms per item
  })

  it('should support ETA calculation', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $streamWithProgress not implemented yet
    const stream = traversal.follows.$streamWithProgress()

    let etaSamples: number[] = []
    let count = 0

    for await (const _node of stream) {
      count++
      if (count >= 10 && count <= 50) {
        // @ts-expect-error - getProgress not implemented yet
        const progress = stream.getProgress()
        if (progress.estimatedRemainingMs !== null) {
          etaSamples.push(progress.estimatedRemainingMs)
        }
      }
      // Simulate consistent processing time
      await new Promise(r => setTimeout(r, 5))
    }

    // ETA should decrease as we progress
    expect(etaSamples.length).toBeGreaterThan(0)
    for (let i = 1; i < etaSamples.length; i++) {
      expect(etaSamples[i]).toBeLessThanOrEqual(etaSamples[i - 1] + 50) // Allow some variance
    }
  })
})

// ============================================================================
// 7. ADVANCED STREAMING PATTERNS
// ============================================================================

describe('Streaming Interface - Advanced Patterns', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should support parallel streaming with $parallelStream', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Stream with parallel processing (4 concurrent)
    // @ts-expect-error - $parallelStream not implemented yet
    const stream = traversal.follows.$parallelStream(4)

    const results: Thing[] = []
    for await (const node of stream) {
      results.push(node)
    }

    // Should get all results
    expect(results).toHaveLength(100)
  })

  it('should support stream transformation with $map', async () => {
    createManyUsers(ctx, 50)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Transform stream items
    // @ts-expect-error - $map not implemented yet
    const stream = traversal.follows.$stream.$map((node: Thing) => ({
      id: node.id,
      name: node.data.name,
    }))

    const results: { id: string; name: unknown }[] = []
    for await (const item of stream) {
      results.push(item)
    }

    expect(results).toHaveLength(50)
    expect(results[0]).toHaveProperty('id')
    expect(results[0]).toHaveProperty('name')
    expect(results[0]).not.toHaveProperty('type')
  })

  it('should support stream filtering with $filter', async () => {
    for (let i = 1; i <= 100; i++) {
      ctx.addThing(createThing(`user-${i}`, 'User', { name: `User ${i}`, index: i }))
    }
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Filter stream items (only even indices)
    // @ts-expect-error - $filter not implemented yet
    const stream = traversal.follows.$stream.$filter((node: Thing) =>
      (node.data.index as number) % 2 === 0
    )

    const results: Thing[] = []
    for await (const item of stream) {
      results.push(item)
    }

    expect(results).toHaveLength(50) // Half of 100
    expect(results.every(r => (r.data.index as number) % 2 === 0)).toBe(true)
  })

  it('should support stream reduction with $reduce', async () => {
    for (let i = 1; i <= 100; i++) {
      ctx.addThing(createThing(`user-${i}`, 'User', { name: `User ${i}`, score: i }))
    }
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Reduce stream to single value (sum of scores)
    // @ts-expect-error - $reduce not implemented yet
    const totalScore = await traversal.follows.$stream.$reduce(
      (acc: number, node: Thing) => acc + (node.data.score as number),
      0
    )

    // Sum of 1 to 100 = 5050
    expect(totalScore).toBe(5050)
  })

  it('should support merging multiple streams with $merge', async () => {
    // Create two hubs with different followers
    ctx.addThing(createThing('hub1', 'User', { name: 'Hub 1' }))
    ctx.addThing(createThing('hub2', 'User', { name: 'Hub 2' }))

    for (let i = 1; i <= 50; i++) {
      ctx.addThing(createThing(`user-a-${i}`, 'User', { name: `User A${i}` }))
      ctx.addRelationship(createRelationship('hub1', 'follows', `user-a-${i}`))
    }
    for (let i = 1; i <= 50; i++) {
      ctx.addThing(createThing(`user-b-${i}`, 'User', { name: `User B${i}` }))
      ctx.addRelationship(createRelationship('hub2', 'follows', `user-b-${i}`))
    }

    const traversal1 = createStreamingTraversal(ctx, ['hub1'])
    const traversal2 = createStreamingTraversal(ctx, ['hub2'])

    // Merge two streams
    // @ts-expect-error - $merge not implemented yet
    const mergedStream = traversal1.follows.$stream.$merge(traversal2.follows.$stream)

    const results: Thing[] = []
    for await (const item of mergedStream) {
      results.push(item)
    }

    expect(results).toHaveLength(100)
    expect(results.filter(r => r.id.startsWith('user-a-'))).toHaveLength(50)
    expect(results.filter(r => r.id.startsWith('user-b-'))).toHaveLength(50)
  })

  it('should support chunked processing with $chunk', async () => {
    createManyUsers(ctx, 100)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 100 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // Process in chunks with async handler
    const processedChunks: number[] = []

    // @ts-expect-error - $chunk not implemented yet
    await traversal.follows.$stream.$chunk(10, async (chunk: Thing[]) => {
      processedChunks.push(chunk.length)
      // Simulate async processing
      await new Promise(r => setTimeout(r, 5))
    })

    expect(processedChunks).toHaveLength(10)
    expect(processedChunks.every(size => size === 10)).toBe(true)
  })
})

// ============================================================================
// 8. STREAM CONSISTENCY AND ISOLATION
// ============================================================================

describe('Streaming Interface - Consistency and Isolation', () => {
  let ctx: StreamingContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  it('should provide snapshot isolation for streams', async () => {
    createManyUsers(ctx, 50)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $snapshotStream not implemented yet
    const stream = traversal.follows.$snapshotStream()

    const results: Thing[] = []
    let addedDuringStream = false

    for await (const node of stream) {
      results.push(node)

      // Try to add new items mid-stream
      if (results.length === 25 && !addedDuringStream) {
        for (let i = 51; i <= 100; i++) {
          ctx.addThing(createThing(`user-${i}`, 'User', { name: `User ${i}` }))
          ctx.addRelationship(createRelationship('hub', 'follows', `user-${i}`))
        }
        addedDuringStream = true
      }
    }

    // Snapshot isolation: should only see original 50
    expect(results).toHaveLength(50)
  })

  it('should support eventual consistency mode', async () => {
    createManyUsers(ctx, 50)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $liveStream not implemented yet
    const stream = traversal.follows.$liveStream()

    const results: Thing[] = []
    let addedDuringStream = false

    for await (const node of stream) {
      results.push(node)

      // Add new items mid-stream
      if (results.length === 25 && !addedDuringStream) {
        for (let i = 51; i <= 60; i++) {
          ctx.addThing(createThing(`user-${i}`, 'User', { name: `User ${i}` }))
          ctx.addRelationship(createRelationship('hub', 'follows', `user-${i}`))
        }
        addedDuringStream = true
      }

      // Stop after processing enough
      if (results.length >= 60) break
    }

    // Live mode: should see newly added items
    expect(results.length).toBeGreaterThanOrEqual(55) // At least original 50 + some new
  })

  it('should detect and handle concurrent modifications', async () => {
    createManyUsers(ctx, 50)
    ctx.addThing(createThing('hub', 'User', { name: 'Hub' }))
    const followerIds = Array.from({ length: 50 }, (_, i) => `user-${i + 1}`)
    createFollowsMany(ctx, 'hub', followerIds)

    const traversal = createStreamingTraversal(ctx, ['hub'])

    // @ts-expect-error - $streamWithConflictDetection not implemented yet
    const stream = traversal.follows.$streamWithConflictDetection()

    let conflictDetected = false

    try {
      for await (const _node of stream) {
        // Modify underlying data mid-stream
        ctx.addRelationship(createRelationship('hub', 'follows', 'new-user'))
      }
    } catch (e) {
      if ((e as Error).message.includes('concurrent modification')) {
        conflictDetected = true
      }
    }

    // Should detect the conflict
    expect(conflictDetected).toBe(true)
  })
})
