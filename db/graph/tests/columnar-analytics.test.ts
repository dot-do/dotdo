/**
 * Columnar Analytics Backend Tests
 *
 * TDD RED phase: Failing tests for columnar analytics queries on graph data.
 *
 * This tests an analytics layer that:
 * - Syncs graph events (completed relationships with *-ed verb forms) to TypedColumnStore
 * - Provides time-series queries on graph data
 * - Aggregates by type and verb for dashboards
 * - Uses efficient compression for timestamps and string dictionaries
 *
 * @see dotdo-0jecj - [RED] TypedColumnStore analytics backend tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { GraphEngine, type Node, type Edge } from '../index'
import { createGraphAnalytics, type GraphAnalytics } from '../analytics'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Generate timestamps for test data
 */
function generateTimestamps(count: number, startTime: number, intervalMs: number): number[] {
  return Array.from({ length: count }, (_, i) => startTime + i * intervalMs)
}

/**
 * Create a populated graph for testing
 */
async function createTestGraph(): Promise<GraphEngine> {
  const graph = new GraphEngine()

  // Create some nodes (Things)
  const users: Node[] = []
  const posts: Node[] = []
  const comments: Node[] = []

  for (let i = 0; i < 10; i++) {
    users.push(await graph.createNode('User', { name: `User ${i}`, email: `user${i}@example.com` }))
  }

  for (let i = 0; i < 25; i++) {
    posts.push(await graph.createNode('Post', { title: `Post ${i}`, content: `Content ${i}` }))
  }

  for (let i = 0; i < 50; i++) {
    comments.push(await graph.createNode('Comment', { text: `Comment ${i}` }))
  }

  // Create relationships with event verbs (*-ed endings)
  // Users created posts
  for (let i = 0; i < 25; i++) {
    const userIdx = i % 10
    await graph.createEdge(users[userIdx]!.id, 'created', posts[i]!.id, { timestamp: Date.now() - (25 - i) * 3600000 })
  }

  // Users updated posts
  for (let i = 0; i < 10; i++) {
    await graph.createEdge(users[i]!.id, 'updated', posts[i]!.id, { timestamp: Date.now() - i * 1800000 })
  }

  // Users liked posts
  for (let i = 0; i < 50; i++) {
    const userIdx = i % 10
    const postIdx = i % 25
    await graph.createEdge(users[userIdx]!.id, 'liked', posts[postIdx]!.id, { timestamp: Date.now() - i * 600000 })
  }

  // Users commented on posts (via comment nodes)
  for (let i = 0; i < 50; i++) {
    const userIdx = i % 10
    await graph.createEdge(users[userIdx]!.id, 'authored', comments[i]!.id, { timestamp: Date.now() - i * 300000 })
  }

  // Comments attached to posts
  for (let i = 0; i < 50; i++) {
    const postIdx = i % 25
    await graph.createEdge(comments[i]!.id, 'attached', posts[postIdx]!.id, { timestamp: Date.now() - i * 300000 })
  }

  return graph
}

// ============================================================================
// Time-Series Queries on Events
// ============================================================================

describe('Time-Series Queries on Events', () => {
  let analytics: GraphAnalytics
  let graph: GraphEngine
  let startTime: number
  let endTime: number

  beforeEach(async () => {
    graph = await createTestGraph()
    analytics = createGraphAnalytics()
    await analytics.ingest(graph)

    // Set time range for queries
    endTime = Date.now()
    startTime = endTime - 24 * 60 * 60 * 1000 // 24 hours ago
  })

  it('queries events by time range', async () => {
    // Events are relationships with verb form ending in -ed (created, updated, deleted)
    const events = await analytics.queryEvents({
      from: startTime,
      to: endTime
    })

    expect(events.length).toBeGreaterThan(0)
    expect(events.every(e => e.verb.endsWith('ed'))).toBe(true)
    expect(events.every(e => e.timestamp >= startTime && e.timestamp <= endTime)).toBe(true)
  })

  it('queries events filtered by verb', async () => {
    const createdEvents = await analytics.queryEvents({
      from: startTime,
      to: endTime,
      verb: 'created'
    })

    expect(createdEvents.length).toBeGreaterThan(0)
    expect(createdEvents.every(e => e.verb === 'created')).toBe(true)
  })

  it('queries events with pagination', async () => {
    const page1 = await analytics.queryEvents({
      from: startTime,
      to: endTime,
      limit: 10,
      offset: 0
    })

    const page2 = await analytics.queryEvents({
      from: startTime,
      to: endTime,
      limit: 10,
      offset: 10
    })

    expect(page1.length).toBeLessThanOrEqual(10)
    expect(page2.length).toBeLessThanOrEqual(10)

    // Pages should be different (if there are enough events)
    if (page1.length === 10 && page2.length > 0) {
      expect(page1[0]!.id).not.toBe(page2[0]!.id)
    }
  })

  it('returns events sorted by timestamp descending', async () => {
    const events = await analytics.queryEvents({
      from: startTime,
      to: endTime,
      limit: 100
    })

    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]!.timestamp).toBeGreaterThanOrEqual(events[i]!.timestamp)
    }
  })

  it('returns empty array for time range with no events', async () => {
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year from now
    const events = await analytics.queryEvents({
      from: farFuture,
      to: farFuture + 1000
    })

    expect(events).toEqual([])
  })
})

// ============================================================================
// Aggregation Queries
// ============================================================================

describe('Aggregation Queries', () => {
  let analytics: GraphAnalytics
  let graph: GraphEngine

  beforeEach(async () => {
    graph = await createTestGraph()
    analytics = createGraphAnalytics()
    await analytics.ingest(graph)
  })

  describe('countByType', () => {
    it('counts nodes by type', async () => {
      const counts = await analytics.countByType()

      expect(counts).toHaveProperty('User')
      expect(counts).toHaveProperty('Post')
      expect(counts).toHaveProperty('Comment')

      expect(counts.User).toBe(10)
      expect(counts.Post).toBe(25)
      expect(counts.Comment).toBe(50)
    })

    it('returns empty object for empty graph', async () => {
      const emptyGraph = new GraphEngine()
      const emptyAnalytics = createGraphAnalytics()
      await emptyAnalytics.ingest(emptyGraph)

      const counts = await emptyAnalytics.countByType()

      expect(Object.keys(counts)).toHaveLength(0)
    })
  })

  describe('countByVerb', () => {
    it('counts relationships by verb', async () => {
      const counts = await analytics.countByVerb()

      expect(counts).toHaveProperty('created')
      expect(counts).toHaveProperty('updated')
      expect(counts).toHaveProperty('liked')
      expect(counts).toHaveProperty('authored')
      expect(counts).toHaveProperty('attached')

      expect(counts.created).toBe(25)
      expect(counts.updated).toBe(10)
      expect(counts.liked).toBe(50)
      expect(counts.authored).toBe(50)
      expect(counts.attached).toBe(50)
    })

    it('returns empty object for graph with no edges', async () => {
      const noEdgesGraph = new GraphEngine()
      await noEdgesGraph.createNode('Test', { name: 'Solo' })

      const noEdgesAnalytics = createGraphAnalytics()
      await noEdgesAnalytics.ingest(noEdgesGraph)

      const counts = await noEdgesAnalytics.countByVerb()

      expect(Object.keys(counts)).toHaveLength(0)
    })
  })

  describe('countByTimeBucket', () => {
    it('aggregates events by hour', async () => {
      const endTime = Date.now()
      const startTime = endTime - 24 * 60 * 60 * 1000

      const hourlyBuckets = await analytics.countByTimeBucket({
        bucket: 'hour',
        from: startTime,
        to: endTime
      })

      expect(hourlyBuckets.length).toBeGreaterThan(0)

      // Each bucket should have a timestamp and count
      for (const bucket of hourlyBuckets) {
        expect(bucket.bucket).toBeGreaterThanOrEqual(startTime)
        expect(bucket.bucket).toBeLessThanOrEqual(endTime)
        expect(bucket.count).toBeGreaterThanOrEqual(0)
      }
    })

    it('aggregates events by day', async () => {
      const endTime = Date.now()
      const startTime = endTime - 7 * 24 * 60 * 60 * 1000 // 7 days

      const dailyBuckets = await analytics.countByTimeBucket({
        bucket: 'day',
        from: startTime,
        to: endTime
      })

      expect(dailyBuckets.length).toBeLessThanOrEqual(8) // At most 8 days
    })

    it('aggregates events by week', async () => {
      const endTime = Date.now()
      const startTime = endTime - 30 * 24 * 60 * 60 * 1000 // 30 days

      const weeklyBuckets = await analytics.countByTimeBucket({
        bucket: 'week',
        from: startTime,
        to: endTime
      })

      expect(weeklyBuckets.length).toBeLessThanOrEqual(5) // At most 5 weeks
    })

    it('returns empty array for range with no events', async () => {
      const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000

      const buckets = await analytics.countByTimeBucket({
        bucket: 'hour',
        from: farFuture,
        to: farFuture + 24 * 60 * 60 * 1000
      })

      expect(buckets).toEqual([])
    })
  })
})

// ============================================================================
// Compression Tests
// ============================================================================

describe('Compression Tests', () => {
  let analytics: GraphAnalytics
  let graph: GraphEngine

  beforeEach(async () => {
    graph = await createTestGraph()
    analytics = createGraphAnalytics()
    await analytics.ingest(graph)
  })

  it('applies delta encoding to timestamps', async () => {
    const stats = await analytics.getCompressionStats()

    // Timestamp column should achieve meaningful compression
    // Delta encoding on monotonic timestamps typically achieves 4-8x compression
    expect(stats.timestampColumn.ratio).toBeGreaterThan(2)
    expect(stats.timestampColumn.compressedBytes).toBeLessThan(stats.timestampColumn.rawBytes)
  })

  it('uses dictionary encoding for type/verb strings', async () => {
    const stats = await analytics.getCompressionStats()

    // Type column should use dictionary encoding
    expect(stats.typeColumn.encoding).toBe('dictionary')
    // With 3 types (User, Post, Comment), dictionary should be small
    expect(stats.typeColumn.dictionarySize).toBeLessThanOrEqual(10)

    // Verb column should use dictionary encoding
    expect(stats.verbColumn.encoding).toBe('dictionary')
    // With 5 verbs (created, updated, liked, authored, attached), dictionary should be small
    expect(stats.verbColumn.dictionarySize).toBeLessThanOrEqual(10)
  })

  it('achieves reasonable overall compression ratio', async () => {
    const stats = await analytics.getCompressionStats()

    // Overall compression should be meaningful
    expect(stats.overallRatio).toBeGreaterThan(1.5)
    expect(stats.totalCompressedBytes).toBeLessThan(stats.totalRawBytes)
  })

  it('reports accurate byte counts', async () => {
    const stats = await analytics.getCompressionStats()

    // Sanity checks on byte counts
    expect(stats.totalRawBytes).toBeGreaterThan(0)
    expect(stats.totalCompressedBytes).toBeGreaterThan(0)
    expect(stats.timestampColumn.rawBytes).toBeGreaterThan(0)
    expect(stats.timestampColumn.compressedBytes).toBeGreaterThan(0)
  })

  it('handles large datasets efficiently', async () => {
    // Create a larger graph for compression testing
    const largeGraph = new GraphEngine()

    // Create 1000 nodes
    const nodes: Node[] = []
    for (let i = 0; i < 1000; i++) {
      nodes.push(await largeGraph.createNode('Event', { index: i }))
    }

    // Create 5000 edges with timestamps
    for (let i = 0; i < 5000; i++) {
      const fromIdx = i % 1000
      const toIdx = (i + 1) % 1000
      await largeGraph.createEdge(nodes[fromIdx]!.id, 'related', nodes[toIdx]!.id, {
        timestamp: Date.now() - i * 1000
      })
    }

    const largeAnalytics = createGraphAnalytics()
    await largeAnalytics.ingest(largeGraph)

    const stats = await largeAnalytics.getCompressionStats()

    // Larger datasets should compress well
    expect(stats.overallRatio).toBeGreaterThan(2)
  })
})

// ============================================================================
// Range Queries
// ============================================================================

describe('Range Queries', () => {
  let analytics: GraphAnalytics
  let graph: GraphEngine
  let startTime: number
  let endTime: number

  beforeEach(async () => {
    graph = await createTestGraph()
    analytics = createGraphAnalytics()
    await analytics.ingest(graph)

    endTime = Date.now()
    startTime = endTime - 24 * 60 * 60 * 1000
  })

  describe('queryThingsByTimeRange', () => {
    it('queries Things created in time range', async () => {
      const result = await analytics.queryThingsByTimeRange({
        from: startTime,
        to: endTime
      })

      expect(result.items.length).toBeGreaterThan(0)
      for (const item of result.items) {
        expect(item.createdAt).toBeGreaterThanOrEqual(startTime)
        expect(item.createdAt).toBeLessThanOrEqual(endTime)
      }
    })

    it('filters Things by type', async () => {
      const result = await analytics.queryThingsByTimeRange({
        from: startTime,
        to: endTime,
        typeName: 'User'
      })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items.every(item => item.typeName === 'User')).toBe(true)
    })

    it('supports cursor-based pagination', async () => {
      const page1 = await analytics.queryThingsByTimeRange({
        from: startTime,
        to: endTime,
        limit: 10
      })

      expect(page1.items.length).toBeLessThanOrEqual(10)

      if (page1.nextCursor) {
        const page2 = await analytics.queryThingsByTimeRange({
          from: startTime,
          to: endTime,
          limit: 10,
          cursor: page1.nextCursor
        })

        // Pages should contain different items
        if (page2.items.length > 0) {
          const page1Ids = new Set(page1.items.map(i => i.id))
          const page2Ids = new Set(page2.items.map(i => i.id))

          // No overlap between pages
          for (const id of page2Ids) {
            expect(page1Ids.has(id)).toBe(false)
          }
        }
      }
    })

    it('returns empty result for range with no Things', async () => {
      const farPast = 0 // Unix epoch
      const result = await analytics.queryThingsByTimeRange({
        from: farPast,
        to: farPast + 1000
      })

      expect(result.items).toEqual([])
      expect(result.nextCursor).toBeUndefined()
    })
  })

  describe('queryRelationshipsByTimeRange', () => {
    it('queries Relationships by timestamp range', async () => {
      const result = await analytics.queryRelationshipsByTimeRange({
        from: startTime,
        to: endTime
      })

      expect(result.items.length).toBeGreaterThan(0)
      for (const item of result.items) {
        expect(item.createdAt).toBeGreaterThanOrEqual(startTime)
        expect(item.createdAt).toBeLessThanOrEqual(endTime)
      }
    })

    it('filters Relationships by verb', async () => {
      const result = await analytics.queryRelationshipsByTimeRange({
        from: startTime,
        to: endTime,
        verb: 'created'
      })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items.every(item => item.verb === 'created')).toBe(true)
    })

    it('supports cursor-based pagination', async () => {
      const page1 = await analytics.queryRelationshipsByTimeRange({
        from: startTime,
        to: endTime,
        limit: 20
      })

      expect(page1.items.length).toBeLessThanOrEqual(20)

      if (page1.nextCursor) {
        const page2 = await analytics.queryRelationshipsByTimeRange({
          from: startTime,
          to: endTime,
          limit: 20,
          cursor: page1.nextCursor
        })

        // Pages should contain different items
        if (page2.items.length > 0) {
          const page1Ids = new Set(page1.items.map(i => i.id))
          const page2Ids = new Set(page2.items.map(i => i.id))

          for (const id of page2Ids) {
            expect(page1Ids.has(id)).toBe(false)
          }
        }
      }
    })

    it('handles narrow time windows efficiently', async () => {
      // Query for just 1 minute of data
      const narrowEnd = Date.now()
      const narrowStart = narrowEnd - 60 * 1000

      const result = await analytics.queryRelationshipsByTimeRange({
        from: narrowStart,
        to: narrowEnd
      })

      // Should return quickly even if no results
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})

// ============================================================================
// Incremental Ingestion
// ============================================================================

describe('Incremental Ingestion', () => {
  let analytics: GraphAnalytics

  beforeEach(() => {
    analytics = createGraphAnalytics()
  })

  it('ingests nodes incrementally', async () => {
    const nodes: Node[] = [
      { id: 'n1', label: 'User', properties: { name: 'Alice' }, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'n2', label: 'User', properties: { name: 'Bob' }, createdAt: Date.now(), updatedAt: Date.now() },
    ]

    await analytics.ingestNodes(nodes)

    const counts = await analytics.countByType()
    expect(counts.User).toBe(2)
  })

  it('ingests edges incrementally', async () => {
    // First ingest nodes
    const nodes: Node[] = [
      { id: 'n1', label: 'User', properties: {}, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'n2', label: 'Post', properties: {}, createdAt: Date.now(), updatedAt: Date.now() },
    ]
    await analytics.ingestNodes(nodes)

    // Then ingest edges
    const edges: Edge[] = [
      { id: 'e1', type: 'created', from: 'n1', to: 'n2', properties: {}, createdAt: Date.now() },
    ]
    await analytics.ingestEdges(edges)

    const counts = await analytics.countByVerb()
    expect(counts.created).toBe(1)
  })

  it('handles multiple incremental batches', async () => {
    // Batch 1
    await analytics.ingestNodes([
      { id: 'n1', label: 'User', properties: {}, createdAt: Date.now(), updatedAt: Date.now() },
    ])

    // Batch 2
    await analytics.ingestNodes([
      { id: 'n2', label: 'User', properties: {}, createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'n3', label: 'Post', properties: {}, createdAt: Date.now(), updatedAt: Date.now() },
    ])

    const counts = await analytics.countByType()
    expect(counts.User).toBe(2)
    expect(counts.Post).toBe(1)
  })

  it('updates compression stats after incremental ingestion', async () => {
    // Initial ingestion
    await analytics.ingestNodes([
      { id: 'n1', label: 'User', properties: {}, createdAt: Date.now(), updatedAt: Date.now() },
    ])

    const stats1 = await analytics.getCompressionStats()
    const initialBytes = stats1.totalRawBytes

    // Add more data
    for (let i = 2; i <= 100; i++) {
      await analytics.ingestNodes([
        { id: `n${i}`, label: 'User', properties: {}, createdAt: Date.now(), updatedAt: Date.now() },
      ])
    }

    const stats2 = await analytics.getCompressionStats()
    expect(stats2.totalRawBytes).toBeGreaterThan(initialBytes)
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let analytics: GraphAnalytics

  beforeEach(() => {
    analytics = createGraphAnalytics()
  })

  it('handles empty graph gracefully', async () => {
    const emptyGraph = new GraphEngine()
    await analytics.ingest(emptyGraph)

    const typeCounts = await analytics.countByType()
    const verbCounts = await analytics.countByVerb()
    const events = await analytics.queryEvents({ from: 0, to: Date.now() })

    expect(Object.keys(typeCounts)).toHaveLength(0)
    expect(Object.keys(verbCounts)).toHaveLength(0)
    expect(events).toEqual([])
  })

  it('handles graph with only nodes (no edges)', async () => {
    const nodesOnlyGraph = new GraphEngine()
    await nodesOnlyGraph.createNode('User', { name: 'Solo' })

    await analytics.ingest(nodesOnlyGraph)

    const typeCounts = await analytics.countByType()
    const verbCounts = await analytics.countByVerb()

    expect(typeCounts.User).toBe(1)
    expect(Object.keys(verbCounts)).toHaveLength(0)
  })

  it('handles invalid time range (from > to)', async () => {
    const graph = await createTestGraph()
    await analytics.ingest(graph)

    const events = await analytics.queryEvents({
      from: Date.now(),
      to: Date.now() - 1000
    })

    expect(events).toEqual([])
  })

  it('handles very large time range', async () => {
    const graph = await createTestGraph()
    await analytics.ingest(graph)

    const events = await analytics.queryEvents({
      from: 0,
      to: Number.MAX_SAFE_INTEGER
    })

    // Should return all events
    expect(events.length).toBeGreaterThan(0)
  })

  it('handles negative timestamps gracefully', async () => {
    await analytics.ingestNodes([
      { id: 'n1', label: 'Ancient', properties: {}, createdAt: -1000, updatedAt: -1000 },
    ])

    const result = await analytics.queryThingsByTimeRange({
      from: -2000,
      to: 0
    })

    expect(result.items.length).toBe(1)
  })

  it('handles zero limit in pagination', async () => {
    const graph = await createTestGraph()
    await analytics.ingest(graph)

    const result = await analytics.queryThingsByTimeRange({
      from: 0,
      to: Date.now(),
      limit: 0
    })

    expect(result.items).toEqual([])
  })

  it('handles very high cardinality data', async () => {
    // Create graph with many unique types
    const highCardGraph = new GraphEngine()

    for (let i = 0; i < 100; i++) {
      await highCardGraph.createNode(`Type${i}`, { index: i })
    }

    await analytics.ingest(highCardGraph)

    const stats = await analytics.getCompressionStats()

    // Dictionary should still work but be larger
    expect(stats.typeColumn.dictionarySize).toBe(100)
  })
})
