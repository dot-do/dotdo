/**
 * Rollup/Compaction Utilities
 *
 * Handles aggregation and compaction of time-series data.
 */

import type { AggregateResult } from './types'

/**
 * Parse a bucket size string into milliseconds
 */
export function parseBucketSize(bucket: string): number {
  const match = bucket.match(/^(\d+)(ms|s|m|h|d)$/)
  if (!match) {
    throw new Error(`Invalid bucket format: ${bucket}`)
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

/**
 * Get the bucket key (ISO timestamp) for a given timestamp
 */
export function getBucketKey(timestamp: number, bucketMs: number): string {
  const bucketStart = Math.floor(timestamp / bucketMs) * bucketMs
  return new Date(bucketStart).toISOString()
}

/**
 * Calculate aggregate metrics from an array of values
 */
export function calculateAggregates(
  values: number[],
  metrics: string[]
): Partial<AggregateResult> {
  if (values.length === 0) {
    return {}
  }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((a, b) => a + b, 0)
  const count = values.length

  const result: Partial<AggregateResult> = {}

  if (metrics.includes('min')) {
    result.min = sorted[0]
  }
  if (metrics.includes('max')) {
    result.max = sorted[count - 1]
  }
  if (metrics.includes('avg')) {
    result.avg = sum / count
  }
  if (metrics.includes('count')) {
    result.count = count
  }
  if (metrics.includes('sum')) {
    result.sum = sum
  }
  if (metrics.includes('p50')) {
    result.p50 = percentile(sorted, 50)
  }
  if (metrics.includes('p99')) {
    result.p99 = percentile(sorted, 99)
  }

  return result
}

/**
 * Calculate percentile from sorted array
 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]

  const index = Math.floor((sorted.length - 1) * (p / 100))
  return sorted[index]
}

/**
 * Group data points by bucket
 */
export function groupByBucket<T extends { timestamp: number }>(
  data: T[],
  bucketMs: number
): Map<string, T[]> {
  const buckets = new Map<string, T[]>()

  for (const item of data) {
    const bucketKey = getBucketKey(item.timestamp, bucketMs)
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, [])
    }
    buckets.get(bucketKey)!.push(item)
  }

  return buckets
}

/**
 * Merge multiple aggregate results (for combining warm tier data)
 */
export function mergeAggregates(results: AggregateResult[]): AggregateResult | null {
  if (results.length === 0) return null
  if (results.length === 1) return results[0]

  // Take the first bucket key (assuming all are from same bucket)
  const bucket = results[0].bucket

  let totalCount = 0
  let totalSum = 0
  let min = Infinity
  let max = -Infinity

  for (const r of results) {
    if (r.count !== undefined) totalCount += r.count
    if (r.sum !== undefined) totalSum += r.sum
    if (r.min !== undefined && r.min < min) min = r.min
    if (r.max !== undefined && r.max > max) max = r.max
  }

  return {
    bucket,
    min: min === Infinity ? undefined : min,
    max: max === -Infinity ? undefined : max,
    avg: totalCount > 0 ? totalSum / totalCount : undefined,
    count: totalCount || undefined,
    sum: totalSum || undefined,
  }
}
