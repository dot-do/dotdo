/**
 * TimeSeriesStore Implementation
 *
 * In-memory implementation with three-tier storage simulation.
 * Hot tier: Recent data in memory (simulating SQLite)
 * Warm tier: Rolled-up aggregates
 * Cold tier: Archived raw data
 */

import type {
  DataPoint,
  AggregateResult,
  TimeSeriesOptions,
  RangeQuery,
  AggregateQuery,
  RollupOptions,
  ArchiveOptions,
  CompactOptions,
  CDCEvent,
  Snapshot,
  RetentionConfig,
} from './types'
import type { CDCEmitter } from '../cdc'

function parseTimestamp(ts: number | Date | string): number {
  if (typeof ts === 'number') return ts
  if (ts instanceof Date) return ts.getTime()
  return new Date(ts).getTime()
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) {
    // Handle formats like "1h", "7d", "365d", "30m"
    const altMatch = duration.match(/^(\d+)([smhd])$/)
    if (!altMatch) throw new Error(`Invalid duration: ${duration}`)
    const [, value, unit] = altMatch
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    }
    return parseInt(value) * multipliers[unit]
  }
  const [, value, unit] = match
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  }
  return parseInt(value) * multipliers[unit]
}

function parseBucketSize(bucket: string): number {
  return parseDuration(bucket)
}

function getBucketKey(timestamp: number, bucketMs: number): string {
  const bucketStart = Math.floor(timestamp / bucketMs) * bucketMs
  return new Date(bucketStart).toISOString()
}

// Simple LRU cache for getAsOf queries
class LRUCache<K, V> {
  private cache = new Map<K, V>()
  private maxSize: number

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest (first) entry
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  clear(): void {
    this.cache.clear()
  }
}

export class TimeSeriesStore<T = unknown> {
  // Hot tier: in-memory storage (simulating SQLite)
  private hotData = new Map<string, Array<{ value: T; timestamp: number }>>()

  // Warm tier: rolled-up aggregates
  private warmData = new Map<string, AggregateResult[]>()

  // Cold tier: archived raw data
  private coldData = new Map<string, Array<{ value: T; timestamp: number }>>()

  // Snapshots
  private snapshots = new Map<string, Snapshot<T>>()
  private snapshotCounter = 0

  // Configuration
  private retention: RetentionConfig
  private retentionMs: number
  private maxVersionsPerKey: number
  private tableName: string
  private onCDC?: (event: CDCEvent) => void
  private cdcEmitter?: CDCEmitter

  // LRU cache for getAsOf
  private asOfCache = new LRUCache<string, T | undefined>(1000)

  constructor(_db: unknown, options: TimeSeriesOptions<T> = {}) {
    this.retention = options.retention || { hot: '1h', warm: '7d', cold: '365d' }
    this.retentionMs = options.retentionMs || parseDuration(this.retention.hot || '1h')
    this.maxVersionsPerKey = options.maxVersionsPerKey || 1000
    this.tableName = options.table || 'timeseries'
    this.onCDC = options.onCDC
    this.cdcEmitter = options.cdcEmitter
  }

  private emitCDC(event: CDCEvent): void {
    if (this.onCDC) {
      this.onCDC(event)
    }
    // Also emit to unified CDC pipeline if configured
    if (this.cdcEmitter) {
      this.cdcEmitter.emit({
        op: event.op as 'c' | 'u' | 'd' | 'r',
        store: 'timeseries',
        table: event.table,
        key: event.key,
        after: event.after as Record<string, unknown> | undefined,
      }).catch(() => {
        // Don't block on CDC pipeline errors
      })
    }
  }

  async put(key: string, value: T, timestamp: number): Promise<void> {
    if (!key) {
      throw new Error('Key cannot be empty')
    }

    if (!this.hotData.has(key)) {
      this.hotData.set(key, [])
    }

    const entries = this.hotData.get(key)!
    entries.push({ value, timestamp })
    // Sort by timestamp
    entries.sort((a, b) => a.timestamp - b.timestamp)

    // Clear LRU cache for this key
    this.asOfCache.clear()

    // Emit CDC event
    this.emitCDC({
      type: 'cdc.insert',
      op: 'c',
      store: 'timeseries',
      table: this.tableName,
      key,
      timestamp: new Date(timestamp).toISOString(),
      after: { value },
    })
  }

  async get(key: string): Promise<T | undefined> {
    // First check hot tier
    const entries = this.hotData.get(key)
    if (entries && entries.length > 0) {
      return entries[entries.length - 1].value
    }

    // Check cold tier for archived data
    const coldEntries = this.coldData.get(key)
    if (coldEntries && coldEntries.length > 0) {
      return coldEntries[coldEntries.length - 1].value
    }

    return undefined
  }

  async getAsOf(key: string, timestamp: number | string): Promise<T | undefined> {
    const ts = parseTimestamp(timestamp)
    const cacheKey = `${key}:${ts}`

    // Check LRU cache
    const cached = this.asOfCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    // Check hot tier first
    const hotEntries = this.hotData.get(key) || []
    // Check cold tier
    const coldEntries = this.coldData.get(key) || []

    // Merge and sort all entries
    const allEntries = [...hotEntries, ...coldEntries].sort((a, b) => a.timestamp - b.timestamp)

    // Find the most recent entry at or before the timestamp
    let result: T | undefined = undefined
    for (const entry of allEntries) {
      if (entry.timestamp <= ts) {
        result = entry.value
      } else {
        break
      }
    }

    // Cache the result
    this.asOfCache.set(cacheKey, result)

    return result
  }

  async putBatch(entries: Array<{ key: string; value: T; timestamp: number }>): Promise<void> {
    for (const entry of entries) {
      await this.put(entry.key, entry.value, entry.timestamp)
    }
  }

  async *range(key: string, range: RangeQuery): AsyncIterable<DataPoint<T>> {
    const startTs = parseTimestamp(range.start)
    const endTs = parseTimestamp(range.end)

    const entries = this.hotData.get(key) || []

    for (const entry of entries) {
      if (entry.timestamp >= startTs && entry.timestamp <= endTs) {
        yield {
          key,
          value: entry.value,
          timestamp: entry.timestamp,
        }
      }
    }
  }

  async aggregate(key: string, query: AggregateQuery): Promise<AggregateResult[]> {
    const startTs = parseTimestamp(query.start)
    const endTs = parseTimestamp(query.end)
    const bucketMs = parseBucketSize(query.bucket)

    // Collect data from hot, warm, and cold tiers
    const hotEntries = this.hotData.get(key) || []
    const coldEntries = this.coldData.get(key) || []

    // Combine all raw entries
    const allEntries = [...hotEntries, ...coldEntries]
      .filter(e => e.timestamp >= startTs && e.timestamp < endTs)
      .sort((a, b) => a.timestamp - b.timestamp)

    // Check if we have warm tier data for this range
    const warmEntries = this.warmData.get(key) || []
    const warmBuckets = new Map<string, AggregateResult>()
    for (const warm of warmEntries) {
      const warmTime = new Date(warm.bucket).getTime()
      if (warmTime >= startTs && warmTime < endTs) {
        warmBuckets.set(warm.bucket, warm)
      }
    }

    // Group by bucket
    const buckets = new Map<string, number[]>()

    for (const entry of allEntries) {
      const bucketKey = getBucketKey(entry.timestamp, bucketMs)
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, [])
      }
      const value = typeof entry.value === 'number' ? entry.value : 0
      buckets.get(bucketKey)!.push(value)
    }

    // Merge warm tier data into buckets
    for (const [bucketKey, warmResult] of warmBuckets) {
      if (!buckets.has(bucketKey) && warmResult.count) {
        // Use warm tier aggregate if no raw data
        // We'll handle this specially below
      }
    }

    // Calculate aggregates
    const results: AggregateResult[] = []
    const allBucketKeys = new Set([...buckets.keys(), ...warmBuckets.keys()])

    for (const bucketKey of Array.from(allBucketKeys).sort()) {
      const bucketTime = new Date(bucketKey).getTime()
      if (bucketTime < startTs || bucketTime >= endTs) continue

      const values = buckets.get(bucketKey)
      const warmResult = warmBuckets.get(bucketKey)

      const result: AggregateResult = { bucket: bucketKey }

      if (values && values.length > 0) {
        // Calculate from raw data
        const sorted = [...values].sort((a, b) => a - b)
        const sum = values.reduce((a, b) => a + b, 0)

        if (query.metrics.includes('min')) {
          result.min = sorted[0]
        }
        if (query.metrics.includes('max')) {
          result.max = sorted[sorted.length - 1]
        }
        if (query.metrics.includes('avg')) {
          result.avg = sum / values.length
        }
        if (query.metrics.includes('count')) {
          result.count = values.length
        }
        if (query.metrics.includes('sum')) {
          result.sum = sum
        }
        if (query.metrics.includes('p50')) {
          result.p50 = sorted[Math.floor(sorted.length * 0.5)]
        }
        if (query.metrics.includes('p99')) {
          result.p99 = sorted[Math.floor(sorted.length * 0.99)]
        }
      } else if (warmResult) {
        // Use warm tier data
        if (query.metrics.includes('min') && warmResult.min !== undefined) {
          result.min = warmResult.min
        }
        if (query.metrics.includes('max') && warmResult.max !== undefined) {
          result.max = warmResult.max
        }
        if (query.metrics.includes('avg') && warmResult.avg !== undefined) {
          result.avg = warmResult.avg
        }
        if (query.metrics.includes('count') && warmResult.count !== undefined) {
          result.count = warmResult.count
        }
        if (query.metrics.includes('sum') && warmResult.sum !== undefined) {
          result.sum = warmResult.sum
        }
        if (query.metrics.includes('p50') && warmResult.p50 !== undefined) {
          result.p50 = warmResult.p50
        }
        if (query.metrics.includes('p99') && warmResult.p99 !== undefined) {
          result.p99 = warmResult.p99
        }
      }

      // Only add if we have data
      if (Object.keys(result).length > 1) {
        results.push(result)
      }
    }

    return results
  }

  async prune(): Promise<number> {
    const cutoff = Date.now() - this.retentionMs
    let pruned = 0

    for (const [key, entries] of this.hotData) {
      const remaining = entries.filter(e => e.timestamp > cutoff)
      pruned += entries.length - remaining.length

      if (remaining.length === 0) {
        this.hotData.delete(key)
      } else {
        this.hotData.set(key, remaining)
      }
    }

    // Clear cache after pruning
    this.asOfCache.clear()

    return pruned
  }

  async compact(options: CompactOptions): Promise<void> {
    for (const [key, entries] of this.hotData) {
      if (entries.length > options.maxVersionsPerKey) {
        // Keep only the most recent N entries
        const remaining = entries.slice(-options.maxVersionsPerKey)
        this.hotData.set(key, remaining)
      }
    }

    // Clear cache after compaction
    this.asOfCache.clear()
  }

  async rollup(options: RollupOptions): Promise<void> {
    const cutoff = Date.now() - parseDuration(options.olderThan)
    const bucketMs = parseBucketSize(options.bucket)

    for (const [key, entries] of this.hotData) {
      const oldEntries = entries.filter(e => e.timestamp < cutoff)
      const recentEntries = entries.filter(e => e.timestamp >= cutoff)

      if (oldEntries.length === 0) continue

      // Group old entries by bucket
      const buckets = new Map<string, number[]>()
      for (const entry of oldEntries) {
        const bucketKey = getBucketKey(entry.timestamp, bucketMs)
        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, [])
        }
        const value = typeof entry.value === 'number' ? entry.value : 0
        buckets.get(bucketKey)!.push(value)
      }

      // Create aggregate results for warm tier
      if (!this.warmData.has(key)) {
        this.warmData.set(key, [])
      }
      const warmResults = this.warmData.get(key)!

      for (const [bucketKey, values] of buckets) {
        const sorted = [...values].sort((a, b) => a - b)
        const sum = values.reduce((a, b) => a + b, 0)

        const result: AggregateResult = { bucket: bucketKey }

        if (options.aggregates.includes('min')) {
          result.min = sorted[0]
        }
        if (options.aggregates.includes('max')) {
          result.max = sorted[sorted.length - 1]
        }
        if (options.aggregates.includes('avg')) {
          result.avg = sum / values.length
        }
        if (options.aggregates.includes('count')) {
          result.count = values.length
        }
        if (options.aggregates.includes('sum')) {
          result.sum = sum
        }

        warmResults.push(result)

        // Emit CDC rollup event
        this.emitCDC({
          type: 'cdc.rollup',
          op: 'r',
          store: 'timeseries',
          table: this.tableName,
          partition: bucketKey,
          count: values.length,
          aggregates: {
            ...(result.min !== undefined ? { min: result.min } : {}),
            ...(result.max !== undefined ? { max: result.max } : {}),
            ...(result.avg !== undefined ? { avg: result.avg } : {}),
            ...(result.count !== undefined ? { count: result.count } : {}),
            ...(result.sum !== undefined ? { sum: result.sum } : {}),
          },
        })
      }

      // Update hot tier to only keep recent entries
      if (recentEntries.length === 0) {
        this.hotData.delete(key)
      } else {
        this.hotData.set(key, recentEntries)
      }
    }

    // Clear cache after rollup
    this.asOfCache.clear()
  }

  async archive(options: ArchiveOptions): Promise<void> {
    const cutoff = Date.now() - parseDuration(options.olderThan)

    // Move old data from hot tier to cold tier
    for (const [key, entries] of this.hotData) {
      const oldEntries = entries.filter(e => e.timestamp < cutoff)
      const recentEntries = entries.filter(e => e.timestamp >= cutoff)

      if (oldEntries.length > 0) {
        if (!this.coldData.has(key)) {
          this.coldData.set(key, [])
        }
        this.coldData.get(key)!.push(...oldEntries)
        // Sort cold data
        this.coldData.get(key)!.sort((a, b) => a.timestamp - b.timestamp)
      }

      if (recentEntries.length === 0) {
        this.hotData.delete(key)
      } else {
        this.hotData.set(key, recentEntries)
      }
    }

    // Also check warm tier for data to archive
    // Warm tier aggregates older than archive cutoff could be moved to cold
    // For now, we keep warm data as-is since it's already aggregated

    // Clear cache after archiving
    this.asOfCache.clear()
  }

  createSnapshot(): string {
    const id = `snapshot-${++this.snapshotCounter}-${Date.now()}`

    // Deep copy all data
    const snapshotHotData = new Map<string, Array<{ value: T; timestamp: number }>>()
    for (const [key, entries] of this.hotData) {
      snapshotHotData.set(key, entries.map(e => ({ ...e })))
    }

    const snapshotWarmData = new Map<string, AggregateResult[]>()
    for (const [key, entries] of this.warmData) {
      snapshotWarmData.set(key, entries.map(e => ({ ...e })))
    }

    const snapshotColdData = new Map<string, Array<{ value: T; timestamp: number }>>()
    for (const [key, entries] of this.coldData) {
      snapshotColdData.set(key, entries.map(e => ({ ...e })))
    }

    this.snapshots.set(id, {
      id,
      data: snapshotHotData,
      warmData: snapshotWarmData,
      coldData: snapshotColdData,
      createdAt: Date.now(),
    })

    return id
  }

  async restoreSnapshot(snapshotId: string): Promise<void> {
    const snapshot = this.snapshots.get(snapshotId)
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`)
    }

    // Restore all data from snapshot
    this.hotData = new Map()
    for (const [key, entries] of snapshot.data) {
      this.hotData.set(key, entries.map(e => ({ ...e })))
    }

    this.warmData = new Map()
    for (const [key, entries] of snapshot.warmData) {
      this.warmData.set(key, entries.map(e => ({ ...e })))
    }

    this.coldData = new Map()
    for (const [key, entries] of snapshot.coldData) {
      this.coldData.set(key, entries.map(e => ({ ...e })))
    }

    // Clear cache after restore
    this.asOfCache.clear()
  }
}
