/**
 * R2 client for warm/cold tier storage
 *
 * Provides a typed interface for R2 operations with:
 * - Automatic JSON serialization/deserialization
 * - Metadata management for tier tracking
 * - Parquet-ready key generation for Iceberg integration
 */

import type {
  StorageTier,
  TierMetadata,
  TieredData,
  R2BucketLike,
  R2PutOptions,
  R2ListOptions,
  TierOperationResult,
  BatchTierResult,
} from './types'
import { createTierMetadata } from './types'

// ============================================================================
// R2 TIER CLIENT
// ============================================================================

/**
 * R2TierClient - Client for warm/cold tier R2 storage
 *
 * @example
 * ```typescript
 * const client = new R2TierClient({
 *   warm: env.R2_WARM,
 *   cold: env.R2_COLD,
 * })
 *
 * // Store in warm tier
 * await client.put('warm', 'user:123', userData)
 *
 * // Retrieve from any tier
 * const data = await client.get('user:123')
 *
 * // Move between tiers
 * await client.move('user:123', 'warm', 'cold')
 * ```
 */
export class R2TierClient<T = unknown> {
  private warmBucket?: R2BucketLike
  private coldBucket?: R2BucketLike
  private keyPrefix: string

  constructor(options: { warm?: R2BucketLike; cold?: R2BucketLike; keyPrefix?: string }) {
    this.warmBucket = options.warm
    this.coldBucket = options.cold
    this.keyPrefix = options.keyPrefix ?? ''
  }

  /**
   * Get the R2 bucket for a tier
   */
  private getBucket(tier: 'warm' | 'cold'): R2BucketLike {
    const bucket = tier === 'warm' ? this.warmBucket : this.coldBucket
    if (!bucket) {
      throw new Error(`No R2 bucket configured for ${tier} tier`)
    }
    return bucket
  }

  /**
   * Build the full R2 key with prefix
   */
  private buildKey(key: string): string {
    return this.keyPrefix ? `${this.keyPrefix}/${key}` : key
  }

  /**
   * Build Iceberg-style partitioned key
   *
   * @example
   * ```typescript
   * // buildPartitionedKey('user:123', 'User', new Date('2024-01-15'))
   * // Returns: 'type=User/dt=2024-01/user:123.json'
   * ```
   */
  buildPartitionedKey(key: string, type: string, date: Date = new Date()): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const partition = `type=${type}/dt=${year}-${month}`
    return `${partition}/${key}.json`
  }

  /**
   * Store data in a tier
   *
   * @param tier - Target tier ('warm' or 'cold')
   * @param key - Storage key
   * @param data - Data to store
   * @param metadata - Optional tier metadata
   */
  async put(tier: 'warm' | 'cold', key: string, data: T, metadata?: Partial<TierMetadata>): Promise<TierOperationResult> {
    const startTime = Date.now()
    const fullKey = this.buildKey(key)

    try {
      const bucket = this.getBucket(tier)

      const tierMetadata: TierMetadata = {
        ...createTierMetadata(tier),
        ...metadata,
        tier,
      }

      const tieredData: TieredData<T> = {
        data,
        metadata: tierMetadata,
      }

      const options: R2PutOptions = {
        customMetadata: {
          tier,
          createdAt: String(tierMetadata.createdAt),
          accessCount: String(tierMetadata.accessCount),
        },
        httpMetadata: {
          contentType: 'application/json',
        },
      }

      await bucket.put(fullKey, JSON.stringify(tieredData), options)

      return {
        success: true,
        toTier: tier,
        key,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        toTier: tier,
        key,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Get data from a specific tier
   *
   * @param tier - Tier to fetch from
   * @param key - Storage key
   */
  async get(tier: 'warm' | 'cold', key: string): Promise<TieredData<T> | null> {
    const fullKey = this.buildKey(key)

    try {
      const bucket = this.getBucket(tier)
      const obj = await bucket.get(fullKey)

      if (!obj) {
        return null
      }

      const text = await obj.text()
      return JSON.parse(text) as TieredData<T>
    } catch {
      return null
    }
  }

  /**
   * Get data from warm tier, falling back to cold
   *
   * @param key - Storage key
   */
  async getWithFallback(key: string): Promise<{ data: TieredData<T> | null; tier: StorageTier | null }> {
    // Try warm first
    if (this.warmBucket) {
      const warmData = await this.get('warm', key)
      if (warmData) {
        return { data: warmData, tier: 'warm' }
      }
    }

    // Fall back to cold
    if (this.coldBucket) {
      const coldData = await this.get('cold', key)
      if (coldData) {
        return { data: coldData, tier: 'cold' }
      }
    }

    return { data: null, tier: null }
  }

  /**
   * Delete data from a tier
   *
   * @param tier - Tier to delete from
   * @param key - Storage key
   */
  async delete(tier: 'warm' | 'cold', key: string): Promise<TierOperationResult> {
    const startTime = Date.now()
    const fullKey = this.buildKey(key)

    try {
      const bucket = this.getBucket(tier)
      await bucket.delete(fullKey)

      return {
        success: true,
        fromTier: tier,
        key,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        fromTier: tier,
        key,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * Delete data from all tiers
   *
   * @param key - Storage key
   */
  async deleteFromAll(key: string): Promise<BatchTierResult> {
    const results: TierOperationResult[] = []

    if (this.warmBucket) {
      results.push(await this.delete('warm', key))
    }
    if (this.coldBucket) {
      results.push(await this.delete('cold', key))
    }

    return {
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    }
  }

  /**
   * Move data between tiers
   *
   * @param key - Storage key
   * @param fromTier - Source tier
   * @param toTier - Destination tier
   */
  async move(key: string, fromTier: 'warm' | 'cold', toTier: 'warm' | 'cold'): Promise<TierOperationResult> {
    const startTime = Date.now()

    try {
      // Get data from source
      const data = await this.get(fromTier, key)
      if (!data) {
        return {
          success: false,
          fromTier,
          toTier,
          key,
          error: `Data not found in ${fromTier} tier`,
          durationMs: Date.now() - startTime,
        }
      }

      // Update metadata
      const updatedMetadata: TierMetadata = {
        ...data.metadata,
        tier: toTier,
      }

      // Put in destination
      const putResult = await this.put(toTier, key, data.data, updatedMetadata)
      if (!putResult.success) {
        return {
          success: false,
          fromTier,
          toTier,
          key,
          error: putResult.error,
          durationMs: Date.now() - startTime,
        }
      }

      // Delete from source
      await this.delete(fromTier, key)

      return {
        success: true,
        fromTier,
        toTier,
        key,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        fromTier,
        toTier,
        key,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * List keys in a tier
   *
   * @param tier - Tier to list
   * @param options - List options
   */
  async list(
    tier: 'warm' | 'cold',
    options?: R2ListOptions
  ): Promise<{
    keys: string[]
    truncated: boolean
    cursor?: string
  }> {
    const bucket = this.getBucket(tier)

    const listOptions: R2ListOptions = {
      ...options,
      prefix: this.keyPrefix ? `${this.keyPrefix}/${options?.prefix ?? ''}` : options?.prefix,
    }

    const result = await bucket.list(listOptions)

    // Strip prefix from keys
    const prefixLength = this.keyPrefix ? this.keyPrefix.length + 1 : 0
    const keys = result.objects.map((obj) => obj.key.slice(prefixLength))

    return {
      keys,
      truncated: result.truncated,
      cursor: result.cursor,
    }
  }

  /**
   * Check if a key exists in a tier
   *
   * @param tier - Tier to check
   * @param key - Storage key
   */
  async exists(tier: 'warm' | 'cold', key: string): Promise<boolean> {
    const fullKey = this.buildKey(key)

    try {
      const bucket = this.getBucket(tier)
      const head = await bucket.head(fullKey)
      return head !== null
    } catch {
      return false
    }
  }

  /**
   * Get metadata without fetching full data
   *
   * @param tier - Tier to check
   * @param key - Storage key
   */
  async getMetadata(tier: 'warm' | 'cold', key: string): Promise<TierMetadata | null> {
    const fullKey = this.buildKey(key)

    try {
      const bucket = this.getBucket(tier)
      const head = await bucket.head(fullKey)

      if (!head || !head.customMetadata) {
        return null
      }

      return {
        tier: (head.customMetadata.tier as StorageTier) ?? tier,
        createdAt: parseInt(head.customMetadata.createdAt ?? '0', 10),
        accessCount: parseInt(head.customMetadata.accessCount ?? '0', 10),
        lastAccess: Date.now(),
        sizeBytes: head.size,
      }
    } catch {
      return null
    }
  }
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Batch move multiple keys between tiers
 */
export async function batchMove<T>(
  client: R2TierClient<T>,
  keys: string[],
  fromTier: 'warm' | 'cold',
  toTier: 'warm' | 'cold',
  options: { concurrency?: number } = {}
): Promise<BatchTierResult> {
  const concurrency = options.concurrency ?? 10
  const results: TierOperationResult[] = []

  // Process in batches for concurrency control
  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map((key) => client.move(key, fromTier, toTier)))
    results.push(...batchResults)
  }

  return {
    total: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  }
}

/**
 * Batch delete multiple keys from a tier
 */
export async function batchDelete<T>(
  client: R2TierClient<T>,
  keys: string[],
  tier: 'warm' | 'cold',
  options: { concurrency?: number } = {}
): Promise<BatchTierResult> {
  const concurrency = options.concurrency ?? 50
  const results: TierOperationResult[] = []

  // Process in batches for concurrency control
  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map((key) => client.delete(tier, key)))
    results.push(...batchResults)
  }

  return {
    total: results.length,
    succeeded: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  }
}
