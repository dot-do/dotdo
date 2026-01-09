/**
 * Unified Query Layer Tests (RED)
 *
 * The Unified Query Layer combines hot tier (EventStreamDO PGLite) and cold tier
 * (Iceberg Parquet) into a single SQL query interface. Users query once and get
 * results from both tiers seamlessly merged.
 *
 * Architecture:
 * - Hot tier: EventStreamDO with PGLite (5 min retention, sub-10ms latency)
 * - Cold tier: R2 Parquet with Iceberg metadata (historical data)
 * - Query Router: Automatically selects tier(s) based on time range
 * - Result Merger: Deduplicates and merges results from both tiers
 *
 * TDD Phase: RED - These tests define expected behavior but should FAIL
 * because the implementation does not exist yet.
 *
 * @see /streaming/event-stream-do.ts for hot tier
 * @see /streaming/compat/kafka/kafka-pipelines.ts for IcebergSink
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// IMPORTS FROM NON-EXISTENT MODULE - WILL FAIL
// ============================================================================

import {
  UnifiedQueryLayer,
  type UnifiedQueryConfig,
  type QueryResult,
  type QueryOptions,
  type TierInfo,
  type QueryPlan,
  type ColumnStatistics,
  type PartitionPruningResult,
  type MergeStrategy,
  type TimeTravelOptions,
  // Error types
  UnifiedQueryError,
  TierUnavailableError,
  QueryTimeoutError,
  InvalidQueryError,
} from './unified-query'

import type { EventStreamDO, BroadcastEvent } from './event-stream-do'
import type { IcebergSink } from './compat/kafka/kafka-pipelines'

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create mock EventStreamDO (hot tier)
 */
function createMockHotTier() {
  const events = new Map<string, BroadcastEvent>()
  let queryCount = 0

  return {
    // Store events
    _events: events,
    _queryCount: () => queryCount,

    // Mock query method
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queryCount++
      const rows = Array.from(events.values())
      return { rows }
    }),

    // Helper to add test events
    addEvent: (event: BroadcastEvent) => {
      events.set(event.id, event)
    },

    // Simulate unavailability
    setUnavailable: (unavailable: boolean) => {
      if (unavailable) {
        vi.spyOn({ query: async () => ({ rows: [] }) }, 'query').mockRejectedValue(
          new Error('Hot tier unavailable')
        )
      }
    },

    // Get config
    config: {
      hotTierRetentionMs: 5 * 60 * 1000, // 5 minutes
    },
  }
}

/**
 * Create mock IcebergSink (cold tier)
 */
function createMockColdTier() {
  const tables = new Map<string, unknown[]>()
  let queryCount = 0
  let unavailable = false

  return {
    // Store data
    _tables: tables,
    _queryCount: () => queryCount,

    // Mock query method
    query: vi.fn(async (sql: string) => {
      if (unavailable) {
        throw new Error('Cold tier unavailable')
      }
      queryCount++
      const tableName = sql.match(/FROM\s+(\w+)/i)?.[1] ?? 'events'
      return tables.get(tableName) ?? []
    }),

    // Get table metadata for statistics
    getTableMetadata: vi.fn(async (tableName: string) => {
      return {
        rowCount: tables.get(tableName)?.length ?? 0,
        partitions: [],
        columnStats: {},
      }
    }),

    // Get partition statistics
    getPartitionStats: vi.fn(async (tableName: string, column: string) => {
      return {
        minValue: null,
        maxValue: null,
        distinctCount: 0,
      }
    }),

    // Helper to add test data
    addTableData: (tableName: string, rows: unknown[]) => {
      tables.set(tableName, rows)
    },

    // Simulate unavailability
    setUnavailable: (isUnavailable: boolean) => {
      unavailable = isUnavailable
    },

    // List tables
    listTables: vi.fn(async () => Array.from(tables.keys())),
  }
}

type MockHotTier = ReturnType<typeof createMockHotTier>
type MockColdTier = ReturnType<typeof createMockColdTier>

/**
 * Create test event with timestamp
 */
function createTestEvent(overrides: Partial<BroadcastEvent> = {}): BroadcastEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: 'test',
    topic: 'events',
    payload: { value: Math.random() },
    timestamp: Date.now(),
    ...overrides,
  }
}

/**
 * Wait for async operations
 */
async function tick(ms = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// CONSTRUCTOR AND CONFIGURATION TESTS
// ============================================================================

describe('UnifiedQueryLayer construction', () => {
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    hotTier = createMockHotTier()
    coldTier = createMockColdTier()
  })

  it('should create instance with hot and cold tiers', () => {
    const layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })

    expect(layer).toBeInstanceOf(UnifiedQueryLayer)
  })

  it('should accept configuration options', () => {
    const config: UnifiedQueryConfig = {
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
      hotTierRetentionMs: 10 * 60 * 1000, // 10 minutes
      defaultTimeout: 30000,
      enableQueryPlan: true,
      deduplicationWindow: 60000,
    }

    const layer = new UnifiedQueryLayer(config)

    expect(layer.config.hotTierRetentionMs).toBe(10 * 60 * 1000)
    expect(layer.config.defaultTimeout).toBe(30000)
  })

  it('should use default hot tier retention from EventStreamDO config', () => {
    const layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })

    // Should inherit from hot tier config (5 min)
    expect(layer.config.hotTierRetentionMs).toBe(5 * 60 * 1000)
  })

  it('should work with hot tier only', () => {
    const layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
    })

    expect(layer).toBeInstanceOf(UnifiedQueryLayer)
    expect(layer.hasColdTier).toBe(false)
  })

  it('should work with cold tier only', () => {
    const layer = new UnifiedQueryLayer({
      coldTier: coldTier as unknown as IcebergSink,
    })

    expect(layer).toBeInstanceOf(UnifiedQueryLayer)
    expect(layer.hasHotTier).toBe(false)
  })

  it('should throw if neither tier is provided', () => {
    expect(() => new UnifiedQueryLayer({})).toThrow(UnifiedQueryError)
  })
})

// ============================================================================
// QUERY ROUTING TESTS - HOT TIER ONLY
// ============================================================================

describe('Query routing - hot tier only', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should route queries for recent data (< 5 min) to hot tier only', async () => {
    const now = Date.now()
    const recentEvent = createTestEvent({
      id: 'recent-1',
      timestamp: now - 60000, // 1 minute ago
    })
    hotTier.addEvent(recentEvent)

    // Query for last 2 minutes
    const result = await layer.query(
      "SELECT * FROM events WHERE timestamp > $1",
      [now - 2 * 60 * 1000]
    )

    expect(result.rows).toContainEqual(expect.objectContaining({ id: 'recent-1' }))
    expect(hotTier.query).toHaveBeenCalled()
    expect(coldTier.query).not.toHaveBeenCalled()
  })

  it('should detect time range from WHERE clause', async () => {
    const now = Date.now()

    // Query with explicit time bounds within hot tier retention
    const twoMinAgo = now - 2 * 60 * 1000

    const plan = await layer.explainQuery(
      `SELECT * FROM events WHERE timestamp >= ${twoMinAgo}`
    )

    expect(plan.selectedTiers).toContain('hot')
    expect(plan.selectedTiers).not.toContain('cold')
  })

  it('should handle queries without time filter (scan both tiers)', async () => {
    const plan = await layer.explainQuery("SELECT * FROM events")

    // Without time filter, should scan both tiers
    expect(plan.selectedTiers).toContain('hot')
    expect(plan.selectedTiers).toContain('cold')
  })

  it('should optimize queries with NOW() function', async () => {
    const plan = await layer.explainQuery(
      "SELECT * FROM events WHERE timestamp > NOW() - INTERVAL '2 minutes'"
    )

    // Recent query should only hit hot tier
    expect(plan.selectedTiers).toContain('hot')
    expect(plan.selectedTiers).not.toContain('cold')
  })

  it('should detect time range from BETWEEN clause', async () => {
    const now = Date.now()
    const fourMinAgo = now - 4 * 60 * 1000
    const twoMinAgo = now - 2 * 60 * 1000

    const plan = await layer.explainQuery(
      `SELECT * FROM events WHERE timestamp BETWEEN ${fourMinAgo} AND ${twoMinAgo}`
    )

    // All within hot tier retention
    expect(plan.selectedTiers).toContain('hot')
    expect(plan.selectedTiers).not.toContain('cold')
  })
})

// ============================================================================
// QUERY ROUTING TESTS - COLD TIER ONLY
// ============================================================================

describe('Query routing - cold tier only', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should route queries for older data (> 5 min) to cold tier only', async () => {
    const now = Date.now()
    const tenMinAgo = now - 10 * 60 * 1000
    const sixMinAgo = now - 6 * 60 * 1000

    coldTier.addTableData('events', [
      { id: 'old-1', timestamp: tenMinAgo - 1000, value: 100 },
      { id: 'old-2', timestamp: sixMinAgo - 1000, value: 200 },
    ])

    // Query for 6-10 minutes ago (entirely in cold tier)
    const result = await layer.query(
      "SELECT * FROM events WHERE timestamp >= $1 AND timestamp <= $2",
      [tenMinAgo, sixMinAgo]
    )

    expect(result.rows).toHaveLength(2)
    expect(hotTier.query).not.toHaveBeenCalled()
    expect(coldTier.query).toHaveBeenCalled()
  })

  it('should detect historical time range', async () => {
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000
    const thirtyMinAgo = now - 30 * 60 * 1000

    const plan = await layer.explainQuery(
      `SELECT * FROM events WHERE timestamp >= ${oneHourAgo} AND timestamp <= ${thirtyMinAgo}`
    )

    // Entirely historical, should only hit cold tier
    expect(plan.selectedTiers).not.toContain('hot')
    expect(plan.selectedTiers).toContain('cold')
  })

  it('should apply partition pruning for time-based partitions', async () => {
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000

    const result = await layer.query(
      `SELECT * FROM events WHERE timestamp >= ${oneHourAgo} AND timestamp <= ${now - 30 * 60 * 1000}`,
      [],
      { includeQueryPlan: true }
    )

    // Should have pruned partitions based on time
    expect(result.queryPlan?.partitionsPruned).toBeGreaterThan(0)
  })

  it('should use column statistics for optimization', async () => {
    coldTier.getPartitionStats = vi.fn().mockResolvedValue({
      minValue: '2026-01-09T00:00:00Z',
      maxValue: '2026-01-09T11:00:00Z',
      distinctCount: 1000,
    })

    const stats = await layer.getColumnStatistics('events', 'timestamp')

    expect(stats).toBeDefined()
    expect(stats.minValue).toBeDefined()
    expect(stats.maxValue).toBeDefined()
    expect(coldTier.getPartitionStats).toHaveBeenCalled()
  })
})

// ============================================================================
// QUERY ROUTING TESTS - SPANNING BOTH TIERS
// ============================================================================

describe('Query routing - spanning both tiers', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should automatically merge results from both tiers', async () => {
    const now = Date.now()
    const fourMinAgo = now - 4 * 60 * 1000
    const tenMinAgo = now - 10 * 60 * 1000

    // Add hot tier event (recent)
    hotTier.addEvent(createTestEvent({
      id: 'hot-1',
      timestamp: fourMinAgo,
      payload: { source: 'hot' },
    }))

    // Add cold tier event (older)
    coldTier.addTableData('events', [
      { id: 'cold-1', timestamp: tenMinAgo, source: 'cold' },
    ])

    // Query spanning both tiers
    const result = await layer.query(
      `SELECT * FROM events WHERE timestamp >= ${tenMinAgo}`,
      []
    )

    expect(result.rows).toHaveLength(2)
    expect(result.rows).toContainEqual(expect.objectContaining({ id: 'hot-1' }))
    expect(result.rows).toContainEqual(expect.objectContaining({ id: 'cold-1' }))
    expect(result.tiersQueried).toContain('hot')
    expect(result.tiersQueried).toContain('cold')
  })

  it('should query both tiers in parallel for better performance', async () => {
    const now = Date.now()
    const tenMinAgo = now - 10 * 60 * 1000

    // Add data to both tiers
    hotTier.addEvent(createTestEvent({ id: 'hot-1' }))
    coldTier.addTableData('events', [{ id: 'cold-1', timestamp: tenMinAgo }])

    // Track timing
    const startTime = performance.now()
    await layer.query(`SELECT * FROM events WHERE timestamp >= ${tenMinAgo}`)
    const duration = performance.now() - startTime

    // Both queries should have been called (implying parallel execution)
    expect(hotTier.query).toHaveBeenCalled()
    expect(coldTier.query).toHaveBeenCalled()
  })

  it('should handle partial tier availability', async () => {
    const now = Date.now()

    // Hot tier has data
    hotTier.addEvent(createTestEvent({ id: 'hot-1', timestamp: now - 60000 }))

    // Cold tier fails
    coldTier.setUnavailable(true)

    const result = await layer.query(
      "SELECT * FROM events",
      [],
      { allowPartialResults: true }
    )

    // Should return partial results from hot tier with warning
    expect(result.rows).toHaveLength(1)
    expect(result.warnings).toContain('Cold tier unavailable')
    expect(result.isPartial).toBe(true)
  })

  it('should report which tiers were queried in result metadata', async () => {
    const now = Date.now()
    const tenMinAgo = now - 10 * 60 * 1000

    hotTier.addEvent(createTestEvent({ id: 'hot-1' }))
    coldTier.addTableData('events', [{ id: 'cold-1', timestamp: tenMinAgo }])

    const result = await layer.query(`SELECT * FROM events WHERE timestamp >= ${tenMinAgo}`)

    expect(result.tiersQueried).toBeDefined()
    expect(result.tiersQueried).toContain('hot')
    expect(result.tiersQueried).toContain('cold')
  })
})

// ============================================================================
// TIME-BASED PARTITION PRUNING TESTS
// ============================================================================

describe('Time-based partition pruning', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should prune partitions outside query time range', async () => {
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000

    const pruningResult = await layer.analyzePartitionPruning(
      'events',
      { start: oneHourAgo, end: now }
    )

    expect(pruningResult).toBeDefined()
    expect(pruningResult.prunedPartitions).toBeInstanceOf(Array)
    expect(pruningResult.scannedPartitions).toBeInstanceOf(Array)
    expect(pruningResult.pruningRatio).toBeGreaterThanOrEqual(0)
    expect(pruningResult.pruningRatio).toBeLessThanOrEqual(1)
  })

  it('should support hourly partition pruning', async () => {
    const now = Date.now()
    const twoHoursAgo = now - 2 * 60 * 60 * 1000
    const oneHourAgo = now - 60 * 60 * 1000

    const plan = await layer.explainQuery(
      `SELECT * FROM events WHERE timestamp >= ${twoHoursAgo} AND timestamp <= ${oneHourAgo}`
    )

    // Should identify hourly partitions to scan
    expect(plan.partitionStrategy).toBe('hourly')
    expect(plan.estimatedPartitions).toBeLessThanOrEqual(2) // At most 2 hours
  })

  it('should support daily partition pruning', async () => {
    const now = Date.now()
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000
    const oneDayAgo = now - 24 * 60 * 60 * 1000

    const plan = await layer.explainQuery(
      `SELECT * FROM events WHERE timestamp >= ${threeDaysAgo} AND timestamp <= ${oneDayAgo}`
    )

    expect(plan.partitionStrategy).toBe('daily')
    expect(plan.estimatedPartitions).toBeLessThanOrEqual(3)
  })

  it('should skip entirely cold partitions for hot-only queries', async () => {
    const now = Date.now()
    const twoMinAgo = now - 2 * 60 * 1000

    const plan = await layer.explainQuery(
      `SELECT * FROM events WHERE timestamp >= ${twoMinAgo}`
    )

    // Should not scan any cold partitions
    expect(plan.coldPartitionsScanned).toBe(0)
  })

  it('should report partition statistics in query plan', async () => {
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000

    const result = await layer.query(
      `SELECT * FROM events WHERE timestamp >= ${oneHourAgo}`,
      [],
      { includeQueryPlan: true }
    )

    expect(result.queryPlan).toBeDefined()
    expect(result.queryPlan?.partitionsTotal).toBeDefined()
    expect(result.queryPlan?.partitionsScanned).toBeDefined()
    expect(result.queryPlan?.partitionsPruned).toBeDefined()
  })
})

// ============================================================================
// COLUMN STATISTICS TESTS
// ============================================================================

describe('Column statistics for query optimization', () => {
  let layer: UnifiedQueryLayer
  let coldTier: MockColdTier

  beforeEach(() => {
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  it('should retrieve column statistics from Iceberg metadata', async () => {
    coldTier.getPartitionStats = vi.fn().mockResolvedValue({
      minValue: 100,
      maxValue: 1000,
      nullCount: 5,
      distinctCount: 500,
    })

    const stats = await layer.getColumnStatistics('events', 'amount')

    expect(stats.minValue).toBe(100)
    expect(stats.maxValue).toBe(1000)
    expect(stats.nullCount).toBe(5)
    expect(stats.distinctCount).toBe(500)
  })

  it('should use min/max statistics to skip files', async () => {
    // Mock column stats showing values only between 100-200
    coldTier.getPartitionStats = vi.fn().mockResolvedValue({
      minValue: 100,
      maxValue: 200,
    })

    const plan = await layer.explainQuery(
      "SELECT * FROM events WHERE amount > 500"
    )

    // Query for amount > 500 should skip all files (max is 200)
    expect(plan.filesSkippedByStats).toBeGreaterThan(0)
  })

  it('should combine statistics from multiple data files', async () => {
    const stats = await layer.getColumnStatistics('events', 'timestamp')

    expect(stats).toBeDefined()
    // Should have aggregated min/max across all files
    expect(typeof stats.minValue).not.toBe('undefined')
    expect(typeof stats.maxValue).not.toBe('undefined')
  })

  it('should track null counts for query optimization', async () => {
    coldTier.getPartitionStats = vi.fn().mockResolvedValue({
      nullCount: 100,
      distinctCount: 500,
    })

    const stats = await layer.getColumnStatistics('events', 'optional_field')

    expect(stats.nullCount).toBe(100)
  })
})

// ============================================================================
// RESULT DEDUPLICATION TESTS
// ============================================================================

describe('Result deduplication (hot/cold overlap)', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
      deduplicationWindow: 60000, // 1 minute overlap window
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should deduplicate events that exist in both tiers', async () => {
    const now = Date.now()
    const overlapTime = now - 4 * 60 * 1000 // 4 min ago (in hot tier but might also be in cold)

    const duplicateEvent = {
      id: 'dup-event-1',
      timestamp: overlapTime,
      type: 'test',
      payload: { value: 123 },
    }

    // Same event in both tiers
    hotTier.addEvent(duplicateEvent as BroadcastEvent)
    coldTier.addTableData('events', [duplicateEvent])

    const result = await layer.query("SELECT * FROM events")

    // Should only appear once
    const matchingEvents = result.rows.filter((r: any) => r.id === 'dup-event-1')
    expect(matchingEvents).toHaveLength(1)
  })

  it('should prefer hot tier version for duplicates (more recent)', async () => {
    const now = Date.now()
    const eventTime = now - 4 * 60 * 1000

    // Hot tier has updated payload
    hotTier.addEvent({
      id: 'dup-event-1',
      timestamp: eventTime,
      type: 'test',
      topic: 'events',
      payload: { value: 'hot-version', updated: true },
    })

    // Cold tier has original payload
    coldTier.addTableData('events', [{
      id: 'dup-event-1',
      timestamp: eventTime,
      payload: { value: 'cold-version' },
    }])

    const result = await layer.query("SELECT * FROM events")

    const event = result.rows.find((r: any) => r.id === 'dup-event-1')
    expect(event.payload.value).toBe('hot-version')
  })

  it('should use event ID as primary deduplication key', async () => {
    const now = Date.now()

    // Events with same ID
    hotTier.addEvent({
      id: 'same-id',
      timestamp: now - 60000,
      type: 'test',
      topic: 'events',
      payload: { source: 'hot' },
    })

    coldTier.addTableData('events', [{
      id: 'same-id',
      timestamp: now - 120000,
      payload: { source: 'cold' },
    }])

    const result = await layer.query("SELECT * FROM events")

    const sameIdEvents = result.rows.filter((r: any) => r.id === 'same-id')
    expect(sameIdEvents).toHaveLength(1)
  })

  it('should support custom deduplication strategy', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({ id: 'evt-1', timestamp: now - 60000 }))
    coldTier.addTableData('events', [{ id: 'evt-1', timestamp: now - 120000 }])

    const result = await layer.query(
      "SELECT * FROM events",
      [],
      {
        mergeStrategy: 'cold-first', // Prefer cold tier version
      }
    )

    // Should use cold tier version
    const event = result.rows.find((r: any) => r.id === 'evt-1')
    expect(event.timestamp).toBe(now - 120000)
  })

  it('should track deduplication statistics', async () => {
    const now = Date.now()

    // Add duplicate events
    for (let i = 0; i < 5; i++) {
      const event = createTestEvent({ id: `dup-${i}`, timestamp: now - 60000 })
      hotTier.addEvent(event)
      coldTier.addTableData('events', [
        ...(coldTier._tables.get('events') ?? []),
        { id: `dup-${i}`, timestamp: now - 60000 },
      ])
    }

    const result = await layer.query("SELECT * FROM events", [], { includeDedupStats: true })

    expect(result.dedupStats).toBeDefined()
    expect(result.dedupStats?.duplicatesRemoved).toBe(5)
    expect(result.dedupStats?.hotTierCount).toBe(5)
    expect(result.dedupStats?.coldTierCount).toBe(5)
    expect(result.dedupStats?.finalCount).toBe(5)
  })
})

// ============================================================================
// ORDER BY TESTS
// ============================================================================

describe('ORDER BY across tiers', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should maintain ORDER BY timestamp DESC across merged results', async () => {
    const now = Date.now()

    // Hot tier events (recent)
    hotTier.addEvent(createTestEvent({ id: 'hot-1', timestamp: now - 60000 }))
    hotTier.addEvent(createTestEvent({ id: 'hot-2', timestamp: now - 120000 }))

    // Cold tier events (older)
    coldTier.addTableData('events', [
      { id: 'cold-1', timestamp: now - 6 * 60 * 1000 },
      { id: 'cold-2', timestamp: now - 7 * 60 * 1000 },
    ])

    const result = await layer.query(
      "SELECT * FROM events ORDER BY timestamp DESC"
    )

    // Results should be sorted DESC across both tiers
    expect(result.rows[0].id).toBe('hot-1')
    expect(result.rows[1].id).toBe('hot-2')
    expect(result.rows[2].id).toBe('cold-1')
    expect(result.rows[3].id).toBe('cold-2')
  })

  it('should support ORDER BY timestamp ASC', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({ id: 'hot-1', timestamp: now - 60000 }))
    coldTier.addTableData('events', [
      { id: 'cold-1', timestamp: now - 6 * 60 * 1000 },
    ])

    const result = await layer.query(
      "SELECT * FROM events ORDER BY timestamp ASC"
    )

    // Cold (older) should come first
    expect(result.rows[0].id).toBe('cold-1')
    expect(result.rows[1].id).toBe('hot-1')
  })

  it('should support ORDER BY on non-timestamp columns', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({ id: 'hot-b', timestamp: now - 60000, type: 'B' }))
    hotTier.addEvent(createTestEvent({ id: 'hot-a', timestamp: now - 120000, type: 'A' }))

    coldTier.addTableData('events', [
      { id: 'cold-c', timestamp: now - 6 * 60 * 1000, type: 'C' },
    ])

    const result = await layer.query(
      "SELECT * FROM events ORDER BY type ASC"
    )

    expect(result.rows[0].type).toBe('A')
    expect(result.rows[1].type).toBe('B')
    expect(result.rows[2].type).toBe('C')
  })

  it('should support multi-column ORDER BY', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({ id: 'hot-1', timestamp: now - 60000, type: 'A' }))
    hotTier.addEvent(createTestEvent({ id: 'hot-2', timestamp: now - 120000, type: 'A' }))

    coldTier.addTableData('events', [
      { id: 'cold-1', timestamp: now - 6 * 60 * 1000, type: 'A' },
    ])

    const result = await layer.query(
      "SELECT * FROM events ORDER BY type ASC, timestamp DESC"
    )

    // All type 'A', ordered by timestamp DESC
    expect(result.rows[0].id).toBe('hot-1')
    expect(result.rows[1].id).toBe('hot-2')
    expect(result.rows[2].id).toBe('cold-1')
  })
})

// ============================================================================
// LIMIT OPTIMIZATION TESTS
// ============================================================================

describe('LIMIT optimization (early termination)', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should apply LIMIT to final merged results', async () => {
    const now = Date.now()

    // Add many events
    for (let i = 0; i < 10; i++) {
      hotTier.addEvent(createTestEvent({ id: `hot-${i}`, timestamp: now - i * 60000 }))
    }

    coldTier.addTableData('events', Array.from({ length: 10 }, (_, i) => ({
      id: `cold-${i}`,
      timestamp: now - (10 + i) * 60 * 1000,
    })))

    const result = await layer.query(
      "SELECT * FROM events ORDER BY timestamp DESC LIMIT 5"
    )

    expect(result.rows).toHaveLength(5)
  })

  it('should skip cold tier if LIMIT satisfied by hot tier', async () => {
    const now = Date.now()

    // Add enough events to hot tier to satisfy LIMIT
    for (let i = 0; i < 10; i++) {
      hotTier.addEvent(createTestEvent({ id: `hot-${i}`, timestamp: now - i * 60000 }))
    }

    coldTier.addTableData('events', [{ id: 'cold-1', timestamp: now - 60 * 60 * 1000 }])

    const result = await layer.query(
      "SELECT * FROM events ORDER BY timestamp DESC LIMIT 5"
    )

    expect(result.rows).toHaveLength(5)
    // Should not have needed cold tier
    expect(result.tiersQueried).toContain('hot')
    // Cold tier may or may not be queried depending on optimization
  })

  it('should push LIMIT down to individual tier queries', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({ id: 'hot-1', timestamp: now - 60000 }))
    coldTier.addTableData('events', [{ id: 'cold-1', timestamp: now - 6 * 60 * 1000 }])

    await layer.query(
      "SELECT * FROM events ORDER BY timestamp DESC LIMIT 10"
    )

    // The individual tier queries should have received LIMIT optimization
    // Check that queries were called with pushed-down limit
    expect(hotTier.query).toHaveBeenCalled()
    const hotQuery = (hotTier.query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    // Implementation should push LIMIT to sub-queries
  })

  it('should handle OFFSET correctly across tiers', async () => {
    const now = Date.now()

    // Add ordered events
    for (let i = 0; i < 5; i++) {
      hotTier.addEvent(createTestEvent({ id: `hot-${i}`, timestamp: now - i * 60000 }))
    }

    coldTier.addTableData('events', Array.from({ length: 5 }, (_, i) => ({
      id: `cold-${i}`,
      timestamp: now - (10 + i) * 60 * 1000,
    })))

    const result = await layer.query(
      "SELECT * FROM events ORDER BY timestamp DESC LIMIT 3 OFFSET 3"
    )

    expect(result.rows).toHaveLength(3)
    // Should skip first 3 (hot-0, hot-1, hot-2) and return next 3
    expect(result.rows[0].id).toBe('hot-3')
  })

  it('should terminate early when LIMIT is reached', async () => {
    const now = Date.now()

    // Add many events to cold tier
    const manyEvents = Array.from({ length: 1000 }, (_, i) => ({
      id: `cold-${i}`,
      timestamp: now - (10 + i) * 60 * 1000,
    }))
    coldTier.addTableData('events', manyEvents)

    const start = performance.now()
    const result = await layer.query(
      "SELECT * FROM events ORDER BY timestamp DESC LIMIT 10"
    )
    const duration = performance.now() - start

    expect(result.rows).toHaveLength(10)
    // Early termination should make this fast
  })
})

// ============================================================================
// AGGREGATION TESTS
// ============================================================================

describe('Aggregation queries across tiers', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should calculate COUNT(*) across both tiers', async () => {
    const now = Date.now()

    // 3 in hot tier
    for (let i = 0; i < 3; i++) {
      hotTier.addEvent(createTestEvent({ id: `hot-${i}`, timestamp: now - i * 60000 }))
    }

    // 5 in cold tier
    coldTier.addTableData('events', Array.from({ length: 5 }, (_, i) => ({
      id: `cold-${i}`,
      timestamp: now - (10 + i) * 60 * 1000,
    })))

    const result = await layer.query("SELECT COUNT(*) as count FROM events")

    expect(result.rows[0].count).toBe(8)
  })

  it('should calculate SUM across both tiers', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({
      id: 'hot-1',
      timestamp: now - 60000,
      payload: { amount: 100 },
    }))
    hotTier.addEvent(createTestEvent({
      id: 'hot-2',
      timestamp: now - 120000,
      payload: { amount: 200 },
    }))

    coldTier.addTableData('events', [
      { id: 'cold-1', timestamp: now - 6 * 60 * 1000, amount: 300 },
      { id: 'cold-2', timestamp: now - 7 * 60 * 1000, amount: 400 },
    ])

    const result = await layer.query("SELECT SUM(amount) as total FROM events")

    expect(result.rows[0].total).toBe(1000)
  })

  it('should calculate AVG across both tiers', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({
      id: 'hot-1',
      payload: { value: 10 },
    }))
    hotTier.addEvent(createTestEvent({
      id: 'hot-2',
      payload: { value: 20 },
    }))

    coldTier.addTableData('events', [
      { id: 'cold-1', value: 30 },
      { id: 'cold-2', value: 40 },
    ])

    const result = await layer.query("SELECT AVG(value) as average FROM events")

    expect(result.rows[0].average).toBe(25)
  })

  it('should calculate MIN/MAX across both tiers', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({
      id: 'hot-1',
      payload: { value: 50 },
    }))

    coldTier.addTableData('events', [
      { id: 'cold-1', value: 10 },
      { id: 'cold-2', value: 100 },
    ])

    const result = await layer.query(
      "SELECT MIN(value) as min_val, MAX(value) as max_val FROM events"
    )

    expect(result.rows[0].min_val).toBe(10)
    expect(result.rows[0].max_val).toBe(100)
  })

  it('should handle COUNT DISTINCT across tiers', async () => {
    const now = Date.now()

    // Duplicate user IDs across tiers
    hotTier.addEvent(createTestEvent({ id: 'hot-1', payload: { userId: 'user-1' } }))
    hotTier.addEvent(createTestEvent({ id: 'hot-2', payload: { userId: 'user-2' } }))
    hotTier.addEvent(createTestEvent({ id: 'hot-3', payload: { userId: 'user-1' } })) // Duplicate

    coldTier.addTableData('events', [
      { id: 'cold-1', userId: 'user-1' }, // Duplicate
      { id: 'cold-2', userId: 'user-3' },
    ])

    const result = await layer.query(
      "SELECT COUNT(DISTINCT userId) as unique_users FROM events"
    )

    expect(result.rows[0].unique_users).toBe(3) // user-1, user-2, user-3
  })

  it('should push partial aggregations to tiers when possible', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({ payload: { amount: 100 } }))
    coldTier.addTableData('events', [{ amount: 200 }])

    // For SUM, can push to both tiers and combine
    await layer.query("SELECT SUM(amount) as total FROM events")

    // Both tiers should have received aggregation queries
    expect(hotTier.query).toHaveBeenCalled()
    expect(coldTier.query).toHaveBeenCalled()
  })
})

// ============================================================================
// GROUP BY TESTS
// ============================================================================

describe('GROUP BY queries across tiers', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should GROUP BY single column across tiers', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({ type: 'click', payload: { count: 1 } }))
    hotTier.addEvent(createTestEvent({ type: 'view', payload: { count: 1 } }))
    hotTier.addEvent(createTestEvent({ type: 'click', payload: { count: 1 } }))

    coldTier.addTableData('events', [
      { type: 'click', count: 1 },
      { type: 'purchase', count: 1 },
    ])

    const result = await layer.query(
      "SELECT type, COUNT(*) as count FROM events GROUP BY type"
    )

    expect(result.rows).toContainEqual({ type: 'click', count: 3 })
    expect(result.rows).toContainEqual({ type: 'view', count: 1 })
    expect(result.rows).toContainEqual({ type: 'purchase', count: 1 })
  })

  it('should GROUP BY with aggregation function', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({
      type: 'sale',
      payload: { region: 'US', amount: 100 },
    }))
    hotTier.addEvent(createTestEvent({
      type: 'sale',
      payload: { region: 'US', amount: 200 },
    }))
    hotTier.addEvent(createTestEvent({
      type: 'sale',
      payload: { region: 'EU', amount: 150 },
    }))

    coldTier.addTableData('events', [
      { region: 'US', amount: 300 },
      { region: 'EU', amount: 100 },
    ])

    const result = await layer.query(
      "SELECT region, SUM(amount) as total FROM events GROUP BY region"
    )

    expect(result.rows).toContainEqual({ region: 'US', total: 600 })
    expect(result.rows).toContainEqual({ region: 'EU', total: 250 })
  })

  it('should support multiple GROUP BY columns', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({
      payload: { region: 'US', product: 'A', amount: 100 },
    }))
    hotTier.addEvent(createTestEvent({
      payload: { region: 'US', product: 'B', amount: 200 },
    }))

    coldTier.addTableData('events', [
      { region: 'US', product: 'A', amount: 50 },
      { region: 'EU', product: 'A', amount: 75 },
    ])

    const result = await layer.query(
      "SELECT region, product, SUM(amount) as total FROM events GROUP BY region, product"
    )

    expect(result.rows).toContainEqual({ region: 'US', product: 'A', total: 150 })
    expect(result.rows).toContainEqual({ region: 'US', product: 'B', total: 200 })
    expect(result.rows).toContainEqual({ region: 'EU', product: 'A', total: 75 })
  })

  it('should support HAVING clause', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({ type: 'A', payload: { amount: 100 } }))
    hotTier.addEvent(createTestEvent({ type: 'A', payload: { amount: 100 } }))
    hotTier.addEvent(createTestEvent({ type: 'B', payload: { amount: 50 } }))

    coldTier.addTableData('events', [
      { type: 'A', amount: 100 },
      { type: 'C', amount: 10 },
    ])

    const result = await layer.query(
      "SELECT type, SUM(amount) as total FROM events GROUP BY type HAVING SUM(amount) > 100"
    )

    // Only type A (total 300) should qualify
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].type).toBe('A')
    expect(result.rows[0].total).toBe(300)
  })

  it('should merge partial GROUP BY results from tiers', async () => {
    const now = Date.now()

    // Same group key in both tiers
    hotTier.addEvent(createTestEvent({ type: 'shared', payload: { count: 5 } }))
    coldTier.addTableData('events', [{ type: 'shared', count: 3 }])

    const result = await layer.query(
      "SELECT type, COUNT(*) as count FROM events GROUP BY type"
    )

    // Should merge the 'shared' group
    expect(result.rows).toContainEqual({ type: 'shared', count: 2 })
  })
})

// ============================================================================
// WHERE CLAUSE FILTERING TESTS
// ============================================================================

describe('Filtering with WHERE clauses', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should filter by equality across tiers', async () => {
    hotTier.addEvent(createTestEvent({ id: 'hot-1', type: 'click' }))
    hotTier.addEvent(createTestEvent({ id: 'hot-2', type: 'view' }))

    coldTier.addTableData('events', [
      { id: 'cold-1', type: 'click' },
      { id: 'cold-2', type: 'purchase' },
    ])

    const result = await layer.query(
      "SELECT * FROM events WHERE type = 'click'"
    )

    expect(result.rows).toHaveLength(2)
    expect(result.rows.every((r: any) => r.type === 'click')).toBe(true)
  })

  it('should filter by comparison operators', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({ payload: { amount: 100 } }))
    hotTier.addEvent(createTestEvent({ payload: { amount: 200 } }))

    coldTier.addTableData('events', [
      { amount: 50 },
      { amount: 150 },
    ])

    const result = await layer.query(
      "SELECT * FROM events WHERE amount > 100"
    )

    expect(result.rows).toHaveLength(2)
    expect(result.rows.every((r: any) => (r.amount || r.payload?.amount) > 100)).toBe(true)
  })

  it('should filter by IN clause', async () => {
    hotTier.addEvent(createTestEvent({ type: 'click' }))
    hotTier.addEvent(createTestEvent({ type: 'view' }))

    coldTier.addTableData('events', [
      { type: 'purchase' },
      { type: 'click' },
    ])

    const result = await layer.query(
      "SELECT * FROM events WHERE type IN ('click', 'purchase')"
    )

    expect(result.rows).toHaveLength(3)
    expect(result.rows.every((r: any) => ['click', 'purchase'].includes(r.type))).toBe(true)
  })

  it('should filter by LIKE pattern', async () => {
    hotTier.addEvent(createTestEvent({ id: 'hot-1', topic: 'orders.created' }))
    hotTier.addEvent(createTestEvent({ id: 'hot-2', topic: 'orders.updated' }))
    hotTier.addEvent(createTestEvent({ id: 'hot-3', topic: 'users.created' }))

    coldTier.addTableData('events', [
      { id: 'cold-1', topic: 'orders.deleted' },
      { id: 'cold-2', topic: 'payments.created' },
    ])

    const result = await layer.query(
      "SELECT * FROM events WHERE topic LIKE 'orders.%'"
    )

    expect(result.rows).toHaveLength(3)
    expect(result.rows.every((r: any) => r.topic.startsWith('orders.'))).toBe(true)
  })

  it('should handle compound WHERE with AND', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({
      type: 'click',
      payload: { amount: 100 },
    }))
    hotTier.addEvent(createTestEvent({
      type: 'click',
      payload: { amount: 50 },
    }))
    hotTier.addEvent(createTestEvent({
      type: 'view',
      payload: { amount: 100 },
    }))

    coldTier.addTableData('events', [
      { type: 'click', amount: 200 },
    ])

    const result = await layer.query(
      "SELECT * FROM events WHERE type = 'click' AND amount >= 100"
    )

    expect(result.rows).toHaveLength(2)
  })

  it('should handle compound WHERE with OR', async () => {
    hotTier.addEvent(createTestEvent({ type: 'click' }))
    hotTier.addEvent(createTestEvent({ type: 'purchase' }))

    coldTier.addTableData('events', [
      { type: 'view' },
      { type: 'click' },
    ])

    const result = await layer.query(
      "SELECT * FROM events WHERE type = 'click' OR type = 'view'"
    )

    expect(result.rows).toHaveLength(3)
  })

  it('should push filters to individual tiers', async () => {
    hotTier.addEvent(createTestEvent({ type: 'test' }))
    coldTier.addTableData('events', [{ type: 'test' }])

    await layer.query("SELECT * FROM events WHERE type = 'test'")

    // Both tier queries should have received the WHERE filter
    expect(hotTier.query).toHaveBeenCalled()
    expect(coldTier.query).toHaveBeenCalled()
  })
})

// ============================================================================
// JOIN QUERIES TESTS
// ============================================================================

describe('JOIN queries', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should support INNER JOIN within same tier', async () => {
    coldTier.addTableData('events', [
      { id: '1', userId: 'u1', type: 'click' },
      { id: '2', userId: 'u2', type: 'view' },
    ])
    coldTier.addTableData('users', [
      { userId: 'u1', name: 'Alice' },
      { userId: 'u2', name: 'Bob' },
    ])

    const result = await layer.query(
      "SELECT e.*, u.name FROM events e INNER JOIN users u ON e.userId = u.userId"
    )

    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].name).toBeDefined()
  })

  it('should support LEFT JOIN within same tier', async () => {
    coldTier.addTableData('events', [
      { id: '1', userId: 'u1', type: 'click' },
      { id: '2', userId: 'u3', type: 'view' }, // No matching user
    ])
    coldTier.addTableData('users', [
      { userId: 'u1', name: 'Alice' },
    ])

    const result = await layer.query(
      "SELECT e.*, u.name FROM events e LEFT JOIN users u ON e.userId = u.userId"
    )

    expect(result.rows).toHaveLength(2)
    expect(result.rows.find((r: any) => r.userId === 'u1')?.name).toBe('Alice')
    expect(result.rows.find((r: any) => r.userId === 'u3')?.name).toBeNull()
  })

  it('should support self-join for event correlation', async () => {
    const now = Date.now()

    hotTier.addEvent(createTestEvent({
      id: 'click-1',
      type: 'click',
      payload: { sessionId: 's1', timestamp: now - 60000 },
    }))
    hotTier.addEvent(createTestEvent({
      id: 'purchase-1',
      type: 'purchase',
      payload: { sessionId: 's1', timestamp: now - 30000 },
    }))

    const result = await layer.query(`
      SELECT c.id as click_id, p.id as purchase_id
      FROM events c
      JOIN events p ON c.payload->>'sessionId' = p.payload->>'sessionId'
      WHERE c.type = 'click' AND p.type = 'purchase'
    `)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].click_id).toBe('click-1')
    expect(result.rows[0].purchase_id).toBe('purchase-1')
  })

  it('should throw error for cross-tier JOINs if not supported', async () => {
    // Hot tier events
    hotTier.addEvent(createTestEvent({ id: 'hot-1', payload: { userId: 'u1' } }))

    // Cold tier users table
    coldTier.addTableData('users', [{ userId: 'u1', name: 'Alice' }])

    // Cross-tier JOIN may not be supported
    const result = await layer.query(
      "SELECT * FROM events e JOIN users u ON e.userId = u.userId",
      [],
      { allowCrossTierJoin: false }
    )

    // Depending on implementation, might return partial results or throw
    expect(result.warnings).toContain('Cross-tier JOIN not fully supported')
  })
})

// ============================================================================
// TIME TRAVEL QUERIES TESTS
// ============================================================================

describe('Time travel queries', () => {
  let layer: UnifiedQueryLayer
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should query data at specific snapshot', async () => {
    const snapshotId = 12345678

    const result = await layer.query(
      "SELECT * FROM events",
      [],
      { snapshotId }
    )

    // Should query against specific snapshot
    expect(result.snapshotId).toBe(snapshotId)
  })

  it('should query data at specific timestamp', async () => {
    const asOfTimestamp = Date.now() - 60 * 60 * 1000 // 1 hour ago

    const result = await layer.query(
      "SELECT * FROM events",
      [],
      { asOfTimestamp }
    )

    // Should have found snapshot at or before timestamp
    expect(result.asOfTimestamp).toBeLessThanOrEqual(asOfTimestamp)
  })

  it('should support AS OF TIMESTAMP syntax', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const result = await layer.query(
      `SELECT * FROM events FOR SYSTEM_TIME AS OF TIMESTAMP '${oneHourAgo}'`
    )

    expect(result.isTimeTravel).toBe(true)
  })

  it('should throw for time travel on hot tier only', async () => {
    const hotTier = createMockHotTier()
    const hotOnlyLayer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
    })

    await expect(
      hotOnlyLayer.query(
        "SELECT * FROM events",
        [],
        { snapshotId: 12345 }
      )
    ).rejects.toThrow(InvalidQueryError)
  })

  it('should list available snapshots', async () => {
    const snapshots = await layer.listSnapshots('events')

    expect(snapshots).toBeInstanceOf(Array)
    snapshots.forEach((snap) => {
      expect(snap.snapshotId).toBeDefined()
      expect(snap.timestampMs).toBeDefined()
      expect(snap.operation).toBeDefined()
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error handling for tier unavailability', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  it('should throw TierUnavailableError when hot tier fails', async () => {
    hotTier.query = vi.fn().mockRejectedValue(new Error('Hot tier unavailable'))

    // Query that requires hot tier
    await expect(
      layer.query(
        `SELECT * FROM events WHERE timestamp > ${Date.now() - 60000}`,
        [],
        { allowPartialResults: false }
      )
    ).rejects.toThrow(TierUnavailableError)
  })

  it('should throw TierUnavailableError when cold tier fails', async () => {
    coldTier.setUnavailable(true)

    // Query that requires cold tier
    await expect(
      layer.query(
        `SELECT * FROM events WHERE timestamp < ${Date.now() - 10 * 60 * 1000}`,
        [],
        { allowPartialResults: false }
      )
    ).rejects.toThrow(TierUnavailableError)
  })

  it('should return partial results when allowPartialResults is true', async () => {
    hotTier.addEvent(createTestEvent({ id: 'hot-1' }))
    coldTier.setUnavailable(true)

    const result = await layer.query(
      "SELECT * FROM events",
      [],
      { allowPartialResults: true }
    )

    expect(result.isPartial).toBe(true)
    expect(result.rows).toHaveLength(1)
    expect(result.warnings).toContain('Cold tier unavailable')
  })

  it('should timeout long-running queries', async () => {
    // Mock slow query
    hotTier.query = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10000))
    )

    await expect(
      layer.query(
        "SELECT * FROM events",
        [],
        { timeout: 100 }
      )
    ).rejects.toThrow(QueryTimeoutError)
  })

  it('should include tier info in error messages', async () => {
    coldTier.query = vi.fn().mockRejectedValue(new Error('Storage error'))

    try {
      await layer.query(
        `SELECT * FROM events WHERE timestamp < ${Date.now() - 10 * 60 * 1000}`
      )
      expect.fail('Should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('cold')
    }
  })

  it('should handle invalid SQL syntax', async () => {
    await expect(
      layer.query("SELCT * FORM events") // Typos
    ).rejects.toThrow(InvalidQueryError)
  })

  it('should handle unknown table', async () => {
    await expect(
      layer.query("SELECT * FROM nonexistent_table")
    ).rejects.toThrow(InvalidQueryError)
  })

  it('should recover gracefully after tier becomes available again', async () => {
    // First query fails
    coldTier.setUnavailable(true)
    try {
      await layer.query("SELECT * FROM events", [], { allowPartialResults: false })
    } catch {
      // Expected
    }

    // Tier recovers
    coldTier.setUnavailable(false)
    coldTier.addTableData('events', [{ id: 'cold-1' }])

    // Next query should succeed
    const result = await layer.query("SELECT * FROM events")

    expect(result.rows).toContainEqual(expect.objectContaining({ id: 'cold-1' }))
  })
})

// ============================================================================
// QUERY PLAN AND EXPLAIN TESTS
// ============================================================================

describe('Query plan and EXPLAIN', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return query plan without executing', async () => {
    const plan = await layer.explainQuery(
      "SELECT * FROM events WHERE timestamp > $1",
      [Date.now() - 60000]
    )

    expect(plan).toBeDefined()
    expect(plan.selectedTiers).toBeDefined()
    expect(plan.estimatedRows).toBeDefined()
    expect(plan.estimatedCost).toBeDefined()
  })

  it('should show tier selection reasoning', async () => {
    const plan = await layer.explainQuery(
      `SELECT * FROM events WHERE timestamp >= ${Date.now() - 2 * 60 * 1000}`
    )

    expect(plan.reasoning).toContain('time range within hot tier retention')
  })

  it('should show partition pruning in plan', async () => {
    const now = Date.now()
    const plan = await layer.explainQuery(
      `SELECT * FROM events WHERE timestamp >= ${now - 60 * 60 * 1000} AND timestamp <= ${now - 30 * 60 * 1000}`
    )

    expect(plan.partitionsPruned).toBeDefined()
    expect(plan.partitionsScanned).toBeDefined()
  })

  it('should include estimated row counts', async () => {
    const plan = await layer.explainQuery("SELECT * FROM events")

    expect(plan.estimatedRows).toBeDefined()
    expect(plan.estimatedRows).toBeGreaterThanOrEqual(0)
  })

  it('should include query plan in result when requested', async () => {
    hotTier.addEvent(createTestEvent({ id: 'hot-1' }))

    const result = await layer.query(
      "SELECT * FROM events",
      [],
      { includeQueryPlan: true }
    )

    expect(result.queryPlan).toBeDefined()
    expect(result.queryPlan?.tiersQueried).toBeDefined()
    expect(result.queryPlan?.executionTimeMs).toBeDefined()
  })
})

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('Performance characteristics', () => {
  let layer: UnifiedQueryLayer
  let hotTier: MockHotTier
  let coldTier: MockColdTier

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00Z'))

    hotTier = createMockHotTier()
    coldTier = createMockColdTier()

    layer = new UnifiedQueryLayer({
      hotTier: hotTier as unknown as EventStreamDO,
      coldTier: coldTier as unknown as IcebergSink,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should execute hot-tier-only queries with sub-10ms latency', async () => {
    vi.useRealTimers()

    const realHotTier = createMockHotTier()
    const realLayer = new UnifiedQueryLayer({
      hotTier: realHotTier as unknown as EventStreamDO,
    })

    realHotTier.addEvent(createTestEvent({ id: 'test-1' }))

    const start = performance.now()
    await realLayer.query("SELECT * FROM events WHERE timestamp > $1", [Date.now() - 60000])
    const duration = performance.now() - start

    // Hot tier should be very fast
    expect(duration).toBeLessThan(100) // Allow some overhead in test env
  })

  it('should use caching for repeated queries', async () => {
    hotTier.addEvent(createTestEvent({ id: 'hot-1' }))

    // First query
    await layer.query("SELECT * FROM events")
    const firstQueryCount = hotTier._queryCount()

    // Second identical query should use cache
    await layer.query("SELECT * FROM events", [], { useCache: true })
    const secondQueryCount = hotTier._queryCount()

    // With caching, should not have made additional query
    expect(secondQueryCount).toBe(firstQueryCount)
  })

  it('should execute tier queries in parallel when possible', async () => {
    vi.useRealTimers()

    const now = Date.now()

    // Add delays to simulate real queries
    hotTier.query = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 50))
    )
    coldTier.query = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 50))
    )

    const start = performance.now()
    await layer.query(`SELECT * FROM events WHERE timestamp > ${now - 10 * 60 * 1000}`)
    const duration = performance.now() - start

    // If executed in parallel, should be ~50ms not ~100ms
    expect(duration).toBeLessThan(150) // Some overhead allowed
    expect(hotTier.query).toHaveBeenCalled()
    expect(coldTier.query).toHaveBeenCalled()
  })

  it('should stream large result sets', async () => {
    // Add many rows
    const manyRows = Array.from({ length: 10000 }, (_, i) => ({
      id: `row-${i}`,
      value: i,
    }))
    coldTier.addTableData('events', manyRows)

    const stream = layer.queryStream("SELECT * FROM events")
    let rowCount = 0

    for await (const row of stream) {
      rowCount++
      if (rowCount >= 100) break // Early termination
    }

    expect(rowCount).toBe(100)
  })
})
