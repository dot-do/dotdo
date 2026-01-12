/**
 * @dotdo/influxdb - Retention Policies using TemporalStore
 *
 * Retention policy management and automatic data pruning backed by TemporalStore.
 * Also provides shard management for organizing data by time periods.
 */

import {
  createTemporalStore,
  type TemporalStore,
  type RetentionPolicy as TSRetentionPolicy,
} from '../../primitives/temporal-store'
import type { StoredPoint } from './storage'

// ============================================================================
// Types
// ============================================================================

/**
 * Retention policy configuration
 */
export interface RetentionPolicyConfig {
  /** Duration to keep data (e.g., '7d', '30d', '1y', 'inf') */
  duration: string
  /** Shard group duration (optional, e.g., '1d', '1w') */
  shardGroupDuration?: string
  /** Whether this is the default policy for the bucket */
  isDefault?: boolean
}

/**
 * A named retention policy
 */
export interface NamedRetentionPolicy extends RetentionPolicyConfig {
  name: string
}

/**
 * Stats from a retention run
 */
export interface RetentionStats {
  pointsRemoved: number
  pointsRetained: number
  shardsRemoved: number
}

/**
 * Information about a shard
 */
export interface ShardInfo {
  id: string
  bucket: string
  startTime: number
  endTime: number
  pointCount: number
  seriesCount: number
}

/**
 * Statistics for a shard
 */
export interface ShardStats {
  pointCount: number
  seriesCount: number
  sizeBytes: number
}

/**
 * Statistics for a bucket
 */
export interface BucketStats {
  totalPoints: number
  totalShards: number
  totalSeries: number
  sizeBytes: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a duration string to milliseconds
 */
function parseDurationToMs(durationStr: string): number | null {
  if (durationStr === 'inf' || durationStr === 'INF') {
    return null // Infinite retention
  }

  const match = durationStr.match(/^(\d+)(s|m|h|d|w|y)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${durationStr}`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]!

  const ms: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  }

  return value * ms[unit]!
}

/**
 * Convert milliseconds to duration string for TemporalStore
 */
function msToDurationString(ms: number): string {
  if (ms >= 7 * 24 * 60 * 60 * 1000 && ms % (7 * 24 * 60 * 60 * 1000) === 0) {
    return `${ms / (7 * 24 * 60 * 60 * 1000)}w`
  }
  if (ms >= 24 * 60 * 60 * 1000 && ms % (24 * 60 * 60 * 1000) === 0) {
    return `${ms / (24 * 60 * 60 * 1000)}d`
  }
  if (ms >= 60 * 60 * 1000 && ms % (60 * 60 * 1000) === 0) {
    return `${ms / (60 * 60 * 1000)}h`
  }
  if (ms >= 60 * 1000 && ms % (60 * 1000) === 0) {
    return `${ms / (60 * 1000)}m`
  }
  if (ms >= 1000 && ms % 1000 === 0) {
    return `${ms / 1000}s`
  }
  return `${ms}ms`
}

// ============================================================================
// RetentionManager
// ============================================================================

/**
 * Manages retention policies for time-series data
 *
 * Uses TemporalStore for time-aware storage with automatic pruning
 * based on configured retention durations.
 */
export class RetentionManager {
  private policies: Map<string, NamedRetentionPolicy> = new Map()
  private stores: Map<string, TemporalStore<StoredPoint>> = new Map()
  private pointKeys: Map<string, Set<string>> = new Map() // bucket:policy -> set of keys
  private pointsMap: Map<string, Map<string, StoredPoint>> = new Map() // bucket:policy -> key -> point

  /**
   * Create a new retention policy
   */
  createPolicy(name: string, config: RetentionPolicyConfig): void {
    this.policies.set(name, { ...config, name })
  }

  /**
   * Update an existing policy
   */
  updatePolicy(name: string, updates: Partial<RetentionPolicyConfig>): void {
    const existing = this.policies.get(name)
    if (!existing) {
      throw new Error(`Policy '${name}' does not exist`)
    }
    this.policies.set(name, { ...existing, ...updates })
  }

  /**
   * Remove a policy
   */
  removePolicy(name: string): void {
    this.policies.delete(name)
  }

  /**
   * Get a policy by name
   */
  getPolicy(name: string): NamedRetentionPolicy | undefined {
    return this.policies.get(name)
  }

  /**
   * List all policies
   */
  listPolicies(): NamedRetentionPolicy[] {
    return Array.from(this.policies.values())
  }

  /**
   * Add a point to a bucket with a specific retention policy
   */
  addPoint(bucket: string, policyName: string, point: StoredPoint): void {
    const storeKey = `${bucket}:${policyName}`
    let store = this.stores.get(storeKey)

    if (!store) {
      const policy = this.policies.get(policyName)
      const durationMs = policy ? parseDurationToMs(policy.duration) : null

      const options: { enableTTL?: boolean; retention?: TSRetentionPolicy } = {}

      if (durationMs !== null) {
        options.enableTTL = true
        options.retention = {
          maxAge: msToDurationString(durationMs),
        }
      }

      store = createTemporalStore<StoredPoint>(options)
      this.stores.set(storeKey, store)
      this.pointKeys.set(storeKey, new Set())
      this.pointsMap.set(storeKey, new Map())
    }

    // Create a unique key for this point
    const pointKey = this.createPointKey(point)
    this.pointKeys.get(storeKey)!.add(pointKey)
    this.pointsMap.get(storeKey)!.set(pointKey, point)

    // Store the point
    store.put(pointKey, point, point.timestamp)
  }

  /**
   * Run retention policy to prune old data
   */
  async runRetention(bucket: string, policyName: string): Promise<RetentionStats> {
    const storeKey = `${bucket}:${policyName}`
    const store = this.stores.get(storeKey)
    const keys = this.pointKeys.get(storeKey)
    const pointsMap = this.pointsMap.get(storeKey)

    if (!store || !keys || !pointsMap) {
      return { pointsRemoved: 0, pointsRetained: 0, shardsRemoved: 0 }
    }

    const policy = this.policies.get(policyName)
    if (!policy) {
      return { pointsRemoved: 0, pointsRetained: keys.size, shardsRemoved: 0 }
    }

    const durationMs = parseDurationToMs(policy.duration)

    // Infinite retention - no pruning
    if (durationMs === null) {
      return { pointsRemoved: 0, pointsRetained: keys.size, shardsRemoved: 0 }
    }

    // Calculate cutoff time
    const cutoff = Date.now() - durationMs
    const keysToRemove: string[] = []

    // Find points older than cutoff
    for (const key of keys) {
      const point = pointsMap.get(key)
      if (point && point.timestamp < cutoff) {
        keysToRemove.push(key)
      }
    }

    // Remove old points
    for (const key of keysToRemove) {
      keys.delete(key)
      pointsMap.delete(key)
    }

    // Also call TemporalStore prune for consistency
    await store.prune({
      maxAge: msToDurationString(durationMs),
    })

    return {
      pointsRemoved: keysToRemove.length,
      pointsRetained: keys.size,
      shardsRemoved: 0,
    }
  }

  /**
   * Query points within a time range
   */
  queryRange(
    bucket: string,
    policyName: string,
    startTime?: number,
    endTime?: number
  ): StoredPoint[] {
    const storeKey = `${bucket}:${policyName}`
    const keys = this.pointKeys.get(storeKey)
    const pointsMap = this.pointsMap.get(storeKey)

    if (!keys || !pointsMap) {
      return []
    }

    const points: StoredPoint[] = []

    // Iterate through all stored points and filter by time range
    for (const key of keys) {
      const point = pointsMap.get(key)
      if (point) {
        if (
          (startTime === undefined || point.timestamp >= startTime) &&
          (endTime === undefined || point.timestamp <= endTime)
        ) {
          points.push(point)
        }
      }
    }

    return points.sort((a, b) => a.timestamp - b.timestamp)
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createPointKey(point: StoredPoint): string {
    const tagStr = Object.entries(point.tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',')

    return `${point.measurement}:${tagStr}:${point.timestamp}`
  }
}

// ============================================================================
// ShardManager
// ============================================================================

/**
 * Manages data shards for efficient time-based data organization
 *
 * Shards group data by time periods (e.g., 1 day, 1 week) to enable
 * efficient retention and queries.
 */
export class ShardManager {
  private shards: Map<string, ShardInfo> = new Map()
  private shardData: Map<string, StoredPoint[]> = new Map()
  private bucketShards: Map<string, Set<string>> = new Map()

  /**
   * Get or create a shard for a given timestamp
   */
  getOrCreateShard(bucket: string, timestamp: number, shardGroupDuration: number): ShardInfo {
    // Calculate shard boundaries
    const shardStart = Math.floor(timestamp / shardGroupDuration) * shardGroupDuration
    const shardEnd = shardStart + shardGroupDuration
    const shardId = `${bucket}:${shardStart}`

    let shard = this.shards.get(shardId)
    if (!shard) {
      shard = {
        id: shardId,
        bucket,
        startTime: shardStart,
        endTime: shardEnd,
        pointCount: 0,
        seriesCount: 0,
      }
      this.shards.set(shardId, shard)
      this.shardData.set(shardId, [])

      // Track shards per bucket
      if (!this.bucketShards.has(bucket)) {
        this.bucketShards.set(bucket, new Set())
      }
      this.bucketShards.get(bucket)!.add(shardId)
    }

    return shard
  }

  /**
   * List all shards for a bucket
   */
  listShards(bucket: string): ShardInfo[] {
    const shardIds = this.bucketShards.get(bucket)
    if (!shardIds) return []

    return Array.from(shardIds)
      .map((id) => this.shards.get(id))
      .filter((s): s is ShardInfo => s !== undefined)
      .sort((a, b) => a.startTime - b.startTime)
  }

  /**
   * Drop all shards with end time before the cutoff
   */
  dropShardsBefore(bucket: string, cutoff: number): number {
    const shardIds = this.bucketShards.get(bucket)
    if (!shardIds) return 0

    let dropped = 0
    const toRemove: string[] = []

    for (const shardId of shardIds) {
      const shard = this.shards.get(shardId)
      if (shard && shard.endTime <= cutoff) {
        toRemove.push(shardId)
        dropped++
      }
    }

    for (const shardId of toRemove) {
      this.shards.delete(shardId)
      this.shardData.delete(shardId)
      shardIds.delete(shardId)
    }

    return dropped
  }

  /**
   * Write a point to a shard
   */
  writeToShard(shardId: string, point: StoredPoint): void {
    const data = this.shardData.get(shardId)
    if (!data) {
      throw new Error(`Shard '${shardId}' does not exist`)
    }

    data.push(point)

    // Update shard stats
    const shard = this.shards.get(shardId)
    if (shard) {
      shard.pointCount = data.length

      // Count unique series
      const seriesKeys = new Set(
        data.map(
          (p) =>
            `${p.measurement}:${Object.entries(p.tags)
              .sort()
              .map(([k, v]) => `${k}=${v}`)
              .join(',')}`
        )
      )
      shard.seriesCount = seriesKeys.size
    }
  }

  /**
   * Read all points from a shard
   */
  readFromShard(shardId: string): StoredPoint[] {
    return this.shardData.get(shardId) ?? []
  }

  /**
   * Read points from multiple shards within a time range
   */
  readFromShards(bucket: string, startTime?: number, endTime?: number): StoredPoint[] {
    const shards = this.listShards(bucket)
    const points: StoredPoint[] = []

    for (const shard of shards) {
      // Skip shards completely outside the range
      if (startTime !== undefined && shard.endTime < startTime) continue
      if (endTime !== undefined && shard.startTime > endTime) continue

      const shardPoints = this.readFromShard(shard.id)
      for (const point of shardPoints) {
        if (
          (startTime === undefined || point.timestamp >= startTime) &&
          (endTime === undefined || point.timestamp <= endTime)
        ) {
          points.push(point)
        }
      }
    }

    return points.sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Get statistics for a shard
   */
  getShardStats(shardId: string): ShardStats | null {
    const shard = this.shards.get(shardId)
    const data = this.shardData.get(shardId)

    if (!shard || !data) return null

    // Estimate size (rough approximation)
    const sizeBytes = data.length * 200 // ~200 bytes per point

    return {
      pointCount: shard.pointCount,
      seriesCount: shard.seriesCount,
      sizeBytes,
    }
  }

  /**
   * Get aggregate statistics for a bucket
   */
  getBucketStats(bucket: string): BucketStats {
    const shards = this.listShards(bucket)
    let totalPoints = 0
    let totalSeries = 0
    let sizeBytes = 0
    const allSeriesKeys = new Set<string>()

    for (const shard of shards) {
      totalPoints += shard.pointCount

      const data = this.shardData.get(shard.id) ?? []
      for (const point of data) {
        const seriesKey = `${point.measurement}:${Object.entries(point.tags)
          .sort()
          .map(([k, v]) => `${k}=${v}`)
          .join(',')}`
        allSeriesKeys.add(seriesKey)
      }

      sizeBytes += data.length * 200
    }

    return {
      totalPoints,
      totalShards: shards.length,
      totalSeries: allSeriesKeys.size,
      sizeBytes,
    }
  }
}
