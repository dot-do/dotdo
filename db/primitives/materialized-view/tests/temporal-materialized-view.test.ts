/**
 * Temporal Materialized View Tests - AS OF Semantics for Point-in-Time View State
 *
 * This test suite defines the expected behavior of temporal queries against
 * materialized views, enabling queries like:
 *
 * ```sql
 * SELECT * FROM orders_summary AS OF TIMESTAMP '2024-01-01'
 * ```
 *
 * Key features tested:
 * - AS OF queries: Query view state at any historical timestamp
 * - Versioned storage: Store view state with timestamps after each refresh
 * - Retention policies: Control how long historical versions are kept
 * - Compaction: Remove old versions while preserving queryable history
 *
 * @see dotdo-1u71j
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createTemporalMaterializedView,
  type TemporalMaterializedView,
  type TemporalMaterializedViewConfig,
  type ViewSnapshot,
  type RetentionPolicy,
  type TemporalViewStats,
} from '../temporal-materialized-view'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface SalesRecord {
  region: string
  product: string
  amount: number
  timestamp: number
}

interface SalesSummary {
  region: string
  totalAmount: number
  count: number
}

/**
 * Fixed base timestamp for deterministic tests (2024-01-01 00:00:00 UTC)
 */
const BASE_TS = 1704067200000

/**
 * Helper to create timestamp relative to base
 */
function ts(offsetMs: number = 0): number {
  return BASE_TS + offsetMs
}

/**
 * Create sample sales records for testing
 */
function createSalesRecords(count: number, region: string = 'NA'): SalesRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    region,
    product: `product-${i}`,
    amount: (i + 1) * 100,
    timestamp: ts(i * 1000),
  }))
}

// ============================================================================
// TEMPORAL MATERIALIZED VIEW CREATION
// ============================================================================

describe('TemporalMaterializedView Creation', () => {
  describe('createTemporalMaterializedView()', () => {
    it('should create a temporal materialized view with default config', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: (records) => {
          const byRegion = new Map<string, SalesSummary>()
          for (const r of records) {
            const existing = byRegion.get(r.region) || { region: r.region, totalAmount: 0, count: 0 }
            existing.totalAmount += r.amount
            existing.count++
            byRegion.set(r.region, existing)
          }
          return Array.from(byRegion.values())
        },
      })

      expect(view).toBeDefined()
      expect(view.getName()).toBe('sales_summary')
    })

    it('should accept custom retention policy', () => {
      const retention: RetentionPolicy = {
        maxVersions: 10,
        maxAge: 86400000, // 1 day
      }

      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: () => [],
        retention,
      })

      expect(view.getRetentionPolicy()).toEqual(retention)
    })

    it('should throw if name is empty', () => {
      expect(() =>
        createTemporalMaterializedView<SalesRecord, SalesSummary>({
          name: '',
          compute: () => [],
        })
      ).toThrow('View name is required')
    })

    it('should throw if compute function is not provided', () => {
      expect(() =>
        createTemporalMaterializedView<SalesRecord, SalesSummary>({
          name: 'test',
          compute: undefined as unknown as () => SalesSummary[],
        })
      ).toThrow('Compute function is required')
    })
  })
})

// ============================================================================
// VERSIONED STATE STORAGE
// ============================================================================

describe('Versioned State Storage', () => {
  let view: TemporalMaterializedView<SalesRecord, SalesSummary>

  beforeEach(() => {
    view = createTemporalMaterializedView({
      name: 'sales_summary',
      compute: (records: SalesRecord[]) => {
        const byRegion = new Map<string, SalesSummary>()
        for (const r of records) {
          const existing = byRegion.get(r.region) || { region: r.region, totalAmount: 0, count: 0 }
          existing.totalAmount += r.amount
          existing.count++
          byRegion.set(r.region, existing)
        }
        return Array.from(byRegion.values())
      },
    })
  })

  describe('refresh()', () => {
    it('should create a new version on each refresh', () => {
      const records1 = createSalesRecords(3, 'NA')
      view.refresh(records1, ts(0))

      const records2 = createSalesRecords(5, 'NA')
      view.refresh(records2, ts(10000))

      const stats = view.getStats()
      expect(stats.versionCount).toBe(2)
    })

    it('should store timestamp with each version', () => {
      const records = createSalesRecords(3, 'NA')
      const refreshTime = ts(5000)

      view.refresh(records, refreshTime)

      const snapshots = view.listSnapshots()
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]?.timestamp).toBe(refreshTime)
    })

    it('should return the computed state', () => {
      const records = createSalesRecords(3, 'NA')
      // Records have amounts: 100, 200, 300 = 600 total

      const result = view.refresh(records, ts(0))

      expect(result).toHaveLength(1)
      expect(result[0]?.region).toBe('NA')
      expect(result[0]?.totalAmount).toBe(600)
      expect(result[0]?.count).toBe(3)
    })

    it('should support multiple regions', () => {
      const records = [
        ...createSalesRecords(2, 'NA'),
        ...createSalesRecords(3, 'EU'),
      ]

      const result = view.refresh(records, ts(0))

      expect(result).toHaveLength(2)
      const naRegion = result.find((r) => r.region === 'NA')
      const euRegion = result.find((r) => r.region === 'EU')
      expect(naRegion?.count).toBe(2)
      expect(euRegion?.count).toBe(3)
    })
  })

  describe('query() - current state', () => {
    it('should return the latest computed state', () => {
      view.refresh(createSalesRecords(3, 'NA'), ts(0))
      view.refresh(createSalesRecords(5, 'NA'), ts(10000))

      const current = view.query()

      expect(current).toHaveLength(1)
      expect(current[0]?.count).toBe(5) // Latest refresh had 5 records
    })

    it('should return empty array if never refreshed', () => {
      const current = view.query()
      expect(current).toHaveLength(0)
    })
  })
})

// ============================================================================
// AS OF QUERIES (Point-in-Time)
// ============================================================================

describe('AS OF Queries', () => {
  let view: TemporalMaterializedView<SalesRecord, SalesSummary>

  beforeEach(() => {
    view = createTemporalMaterializedView({
      name: 'sales_summary',
      compute: (records: SalesRecord[]) => {
        const byRegion = new Map<string, SalesSummary>()
        for (const r of records) {
          const existing = byRegion.get(r.region) || { region: r.region, totalAmount: 0, count: 0 }
          existing.totalAmount += r.amount
          existing.count++
          byRegion.set(r.region, existing)
        }
        return Array.from(byRegion.values())
      },
    })

    // Set up versioned history
    view.refresh(createSalesRecords(3, 'NA'), ts(0)) // Version 1 at t=0
    view.refresh(createSalesRecords(5, 'NA'), ts(10000)) // Version 2 at t=10s
    view.refresh(createSalesRecords(8, 'NA'), ts(20000)) // Version 3 at t=20s
  })

  describe('queryAsOf(timestamp)', () => {
    it('should return view state at exact refresh timestamp', () => {
      const result = view.queryAsOf(ts(10000))

      expect(result).toHaveLength(1)
      expect(result[0]?.count).toBe(5) // Version 2 had 5 records
    })

    it('should return view state at most recent version before timestamp', () => {
      // Query at t=15s should return version from t=10s
      const result = view.queryAsOf(ts(15000))

      expect(result).toHaveLength(1)
      expect(result[0]?.count).toBe(5)
    })

    it('should return empty if timestamp is before any version', () => {
      const result = view.queryAsOf(ts(-5000))

      expect(result).toHaveLength(0)
    })

    it('should return latest version for future timestamps', () => {
      const result = view.queryAsOf(ts(100000))

      expect(result).toHaveLength(1)
      expect(result[0]?.count).toBe(8)
    })

    it('should support querying with Date object', () => {
      const queryDate = new Date(ts(10000))
      const result = view.queryAsOf(queryDate)

      expect(result).toHaveLength(1)
      expect(result[0]?.count).toBe(5)
    })

    it('should support querying with ISO string', () => {
      const queryDate = new Date(ts(10000)).toISOString()
      const result = view.queryAsOf(queryDate)

      expect(result).toHaveLength(1)
      expect(result[0]?.count).toBe(5)
    })
  })

  describe('AS OF with data evolution', () => {
    it('should track data changes over time', () => {
      // Query each historical state
      const v1 = view.queryAsOf(ts(0))
      const v2 = view.queryAsOf(ts(10000))
      const v3 = view.queryAsOf(ts(20000))

      expect(v1[0]?.count).toBe(3)
      expect(v2[0]?.count).toBe(5)
      expect(v3[0]?.count).toBe(8)
    })

    it('should show aggregate evolution', () => {
      // Records have sequential amounts: 100, 200, 300, etc.
      // 3 records: 100+200+300 = 600
      // 5 records: 100+200+300+400+500 = 1500
      // 8 records: 100+200+300+400+500+600+700+800 = 3600

      const v1 = view.queryAsOf(ts(0))
      const v2 = view.queryAsOf(ts(10000))
      const v3 = view.queryAsOf(ts(20000))

      expect(v1[0]?.totalAmount).toBe(600)
      expect(v2[0]?.totalAmount).toBe(1500)
      expect(v3[0]?.totalAmount).toBe(3600)
    })
  })
})

// ============================================================================
// TEMPORAL RANGE QUERIES
// ============================================================================

describe('Temporal Range Queries', () => {
  let view: TemporalMaterializedView<SalesRecord, SalesSummary>

  beforeEach(() => {
    view = createTemporalMaterializedView({
      name: 'sales_summary',
      compute: (records: SalesRecord[]) => {
        const byRegion = new Map<string, SalesSummary>()
        for (const r of records) {
          const existing = byRegion.get(r.region) || { region: r.region, totalAmount: 0, count: 0 }
          existing.totalAmount += r.amount
          existing.count++
          byRegion.set(r.region, existing)
        }
        return Array.from(byRegion.values())
      },
    })

    // Create versions at different times
    view.refresh(createSalesRecords(3, 'NA'), ts(0))
    view.refresh(createSalesRecords(5, 'NA'), ts(10000))
    view.refresh(createSalesRecords(8, 'NA'), ts(20000))
    view.refresh(createSalesRecords(10, 'NA'), ts(30000))
  })

  describe('queryVersionsBetween(start, end)', () => {
    it('should return all versions within time range', () => {
      const versions = view.queryVersionsBetween(ts(5000), ts(25000))

      // Should include versions at t=10s and t=20s
      expect(versions).toHaveLength(2)
      expect(versions[0]?.data[0]?.count).toBe(5)
      expect(versions[1]?.data[0]?.count).toBe(8)
    })

    it('should include versions at boundary timestamps', () => {
      const versions = view.queryVersionsBetween(ts(10000), ts(20000))

      expect(versions).toHaveLength(2)
    })

    it('should return empty array if no versions in range', () => {
      const versions = view.queryVersionsBetween(ts(5000), ts(8000))

      expect(versions).toHaveLength(0)
    })

    it('should return all versions if range covers all', () => {
      const versions = view.queryVersionsBetween(ts(-10000), ts(100000))

      expect(versions).toHaveLength(4)
    })
  })
})

// ============================================================================
// RETENTION POLICIES
// ============================================================================

describe('Retention Policies', () => {
  describe('maxVersions retention', () => {
    it('should keep only the specified number of versions', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: (records) => [{ region: 'NA', totalAmount: records.length * 100, count: records.length }],
        retention: { maxVersions: 3 },
      })

      // Create 5 versions
      for (let i = 0; i < 5; i++) {
        view.refresh(createSalesRecords(i + 1, 'NA'), ts(i * 10000))
      }

      // After compaction, should only have 3 versions
      const stats = view.compact()
      expect(stats.versionsRemoved).toBe(2)
      expect(view.getStats().versionCount).toBe(3)
    })

    it('should keep most recent versions', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: (records) => [{ region: 'NA', totalAmount: records.length * 100, count: records.length }],
        retention: { maxVersions: 2 },
      })

      view.refresh(createSalesRecords(1, 'NA'), ts(0))
      view.refresh(createSalesRecords(2, 'NA'), ts(10000))
      view.refresh(createSalesRecords(3, 'NA'), ts(20000))

      view.compact()

      // Should keep versions from t=10s and t=20s
      const snapshots = view.listSnapshots()
      expect(snapshots).toHaveLength(2)
      expect(snapshots[0]?.timestamp).toBe(ts(10000))
      expect(snapshots[1]?.timestamp).toBe(ts(20000))
    })
  })

  describe('maxAge retention', () => {
    it('should remove versions older than maxAge', () => {
      vi.useFakeTimers()
      vi.setSystemTime(ts(50000))

      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: (records) => [{ region: 'NA', totalAmount: records.length * 100, count: records.length }],
        retention: { maxAge: 30000 }, // 30 seconds
      })

      // Create versions at different times relative to "now" (t=50s)
      view.refresh(createSalesRecords(1, 'NA'), ts(0)) // 50s old - should be removed
      view.refresh(createSalesRecords(2, 'NA'), ts(10000)) // 40s old - should be removed
      view.refresh(createSalesRecords(3, 'NA'), ts(25000)) // 25s old - keep
      view.refresh(createSalesRecords(4, 'NA'), ts(40000)) // 10s old - keep

      const stats = view.compact()

      expect(stats.versionsRemoved).toBe(2)
      expect(view.getStats().versionCount).toBe(2)

      vi.useRealTimers()
    })
  })

  describe('combined retention policies', () => {
    it('should apply both maxVersions and maxAge', () => {
      vi.useFakeTimers()
      vi.setSystemTime(ts(50000))

      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: (records) => [{ region: 'NA', totalAmount: records.length * 100, count: records.length }],
        retention: { maxVersions: 5, maxAge: 25000 },
      })

      // Create 6 versions
      for (let i = 0; i < 6; i++) {
        view.refresh(createSalesRecords(i + 1, 'NA'), ts(i * 10000))
      }

      view.compact()

      // maxAge=25s removes versions older than t=25s (keeps t=30s, t=40s, t=50s)
      // maxVersions=5 would keep more, but maxAge is more restrictive
      const snapshots = view.listSnapshots()
      expect(snapshots.every((s) => s.timestamp >= ts(25000))).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('setRetentionPolicy()', () => {
    it('should update retention policy dynamically', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: () => [],
      })

      view.setRetentionPolicy({ maxVersions: 10 })

      expect(view.getRetentionPolicy()).toEqual({ maxVersions: 10 })
    })
  })
})

// ============================================================================
// SNAPSHOT MANAGEMENT
// ============================================================================

describe('Snapshot Management', () => {
  let view: TemporalMaterializedView<SalesRecord, SalesSummary>

  beforeEach(() => {
    view = createTemporalMaterializedView({
      name: 'sales_summary',
      compute: (records: SalesRecord[]) => {
        const byRegion = new Map<string, SalesSummary>()
        for (const r of records) {
          const existing = byRegion.get(r.region) || { region: r.region, totalAmount: 0, count: 0 }
          existing.totalAmount += r.amount
          existing.count++
          byRegion.set(r.region, existing)
        }
        return Array.from(byRegion.values())
      },
    })
  })

  describe('listSnapshots()', () => {
    it('should list all stored snapshots with metadata', () => {
      view.refresh(createSalesRecords(3, 'NA'), ts(0))
      view.refresh(createSalesRecords(5, 'NA'), ts(10000))

      const snapshots = view.listSnapshots()

      expect(snapshots).toHaveLength(2)
      expect(snapshots[0]).toMatchObject({
        timestamp: ts(0),
        version: 1,
      })
      expect(snapshots[1]).toMatchObject({
        timestamp: ts(10000),
        version: 2,
      })
    })

    it('should include row count in snapshot info', () => {
      view.refresh(createSalesRecords(3, 'NA'), ts(0))

      const snapshots = view.listSnapshots()

      expect(snapshots[0]?.rowCount).toBe(1) // 1 aggregated row (1 region)
    })

    it('should return empty array if no snapshots', () => {
      const snapshots = view.listSnapshots()

      expect(snapshots).toHaveLength(0)
    })
  })

  describe('getSnapshot(version)', () => {
    it('should return specific snapshot by version number', () => {
      view.refresh(createSalesRecords(3, 'NA'), ts(0))
      view.refresh(createSalesRecords(5, 'NA'), ts(10000))

      const snapshot = view.getSnapshot(1)

      expect(snapshot).toBeDefined()
      expect(snapshot?.data[0]?.count).toBe(3)
    })

    it('should return undefined for non-existent version', () => {
      view.refresh(createSalesRecords(3, 'NA'), ts(0))

      const snapshot = view.getSnapshot(999)

      expect(snapshot).toBeUndefined()
    })
  })

  describe('deleteSnapshot(version)', () => {
    it('should remove a specific snapshot', () => {
      view.refresh(createSalesRecords(3, 'NA'), ts(0))
      view.refresh(createSalesRecords(5, 'NA'), ts(10000))
      view.refresh(createSalesRecords(8, 'NA'), ts(20000))

      const deleted = view.deleteSnapshot(2)

      expect(deleted).toBe(true)
      expect(view.listSnapshots()).toHaveLength(2)
      expect(view.getSnapshot(2)).toBeUndefined()
    })

    it('should return false if snapshot not found', () => {
      view.refresh(createSalesRecords(3, 'NA'), ts(0))

      const deleted = view.deleteSnapshot(999)

      expect(deleted).toBe(false)
    })
  })
})

// ============================================================================
// STATISTICS
// ============================================================================

describe('Statistics', () => {
  it('should track version count', () => {
    const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
      name: 'sales_summary',
      compute: () => [{ region: 'NA', totalAmount: 100, count: 1 }],
    })

    view.refresh([], ts(0))
    view.refresh([], ts(10000))
    view.refresh([], ts(20000))

    expect(view.getStats().versionCount).toBe(3)
  })

  it('should track total refreshes', () => {
    const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
      name: 'sales_summary',
      compute: () => [],
    })

    view.refresh([], ts(0))
    view.refresh([], ts(10000))
    view.compact()
    view.refresh([], ts(20000))

    expect(view.getStats().totalRefreshes).toBe(3)
  })

  it('should track last refresh time', () => {
    const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
      name: 'sales_summary',
      compute: () => [],
    })

    view.refresh([], ts(0))
    view.refresh([], ts(10000))

    expect(view.getStats().lastRefreshTime).toBe(ts(10000))
  })

  it('should estimate memory usage', () => {
    const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
      name: 'sales_summary',
      compute: (records) => [{ region: 'NA', totalAmount: records.length * 100, count: records.length }],
    })

    view.refresh(createSalesRecords(100, 'NA'), ts(0))
    view.refresh(createSalesRecords(100, 'NA'), ts(10000))

    const stats = view.getStats()
    expect(stats.estimatedMemoryBytes).toBeGreaterThan(0)
  })

  it('should return complete stats object', () => {
    const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
      name: 'sales_summary',
      compute: () => [{ region: 'NA', totalAmount: 100, count: 1 }],
      retention: { maxVersions: 10 },
    })

    view.refresh([], ts(0))

    const stats = view.getStats()

    expect(stats).toMatchObject({
      name: 'sales_summary',
      versionCount: 1,
      totalRefreshes: 1,
      lastRefreshTime: ts(0),
    })
    expect(stats.estimatedMemoryBytes).toBeDefined()
    expect(stats.retention).toEqual({ maxVersions: 10 })
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  describe('empty data handling', () => {
    it('should handle refresh with empty input', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: () => [],
      })

      const result = view.refresh([], ts(0))

      expect(result).toHaveLength(0)
      expect(view.getStats().versionCount).toBe(1)
    })

    it('should handle queryAsOf when compute returns empty', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: () => [],
      })

      view.refresh([], ts(0))

      const result = view.queryAsOf(ts(0))
      expect(result).toHaveLength(0)
    })
  })

  describe('rapid refreshes', () => {
    it('should handle multiple refreshes at same timestamp', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: (records) => [{ region: 'NA', totalAmount: records.length * 100, count: records.length }],
      })

      view.refresh(createSalesRecords(1, 'NA'), ts(0))
      view.refresh(createSalesRecords(2, 'NA'), ts(0)) // Same timestamp

      // Should keep both or replace? (Implementation decision: replace)
      const result = view.queryAsOf(ts(0))
      expect(result[0]?.count).toBe(2) // Latest value at that timestamp
    })
  })

  describe('boundary conditions', () => {
    it('should handle timestamp at 0', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: () => [{ region: 'NA', totalAmount: 100, count: 1 }],
      })

      view.refresh([], 0)

      const result = view.queryAsOf(0)
      expect(result).toHaveLength(1)
    })

    it('should handle very large timestamps', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: () => [{ region: 'NA', totalAmount: 100, count: 1 }],
      })

      const largeTs = Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year from now
      view.refresh([], largeTs)

      const result = view.queryAsOf(largeTs)
      expect(result).toHaveLength(1)
    })
  })

  describe('concurrent access patterns', () => {
    it('should handle interleaved refresh and query', () => {
      const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
        name: 'sales_summary',
        compute: (records) => [{ region: 'NA', totalAmount: records.length * 100, count: records.length }],
      })

      view.refresh(createSalesRecords(3, 'NA'), ts(0))
      const q1 = view.query()
      view.refresh(createSalesRecords(5, 'NA'), ts(10000))
      const q2 = view.query()

      expect(q1[0]?.count).toBe(3)
      expect(q2[0]?.count).toBe(5)
    })
  })
})

// ============================================================================
// CLEAR AND RESET
// ============================================================================

describe('Clear and Reset', () => {
  it('should clear all versions', () => {
    const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
      name: 'sales_summary',
      compute: () => [{ region: 'NA', totalAmount: 100, count: 1 }],
    })

    view.refresh([], ts(0))
    view.refresh([], ts(10000))
    view.clear()

    expect(view.getStats().versionCount).toBe(0)
    expect(view.query()).toHaveLength(0)
  })

  it('should reset statistics after clear', () => {
    const view = createTemporalMaterializedView<SalesRecord, SalesSummary>({
      name: 'sales_summary',
      compute: () => [],
    })

    view.refresh([], ts(0))
    view.clear()

    const stats = view.getStats()
    expect(stats.totalRefreshes).toBe(0)
    expect(stats.lastRefreshTime).toBeUndefined()
  })
})
