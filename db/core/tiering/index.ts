/**
 * Three-tier storage infrastructure
 *
 * Provides base classes and utilities for tiered storage:
 * - Hot tier: DO SQLite (<1ms, ~100MB)
 * - Warm tier: R2 Parquet (~50ms, ~10GB)
 * - Cold tier: R2 Iceberg Archive (~100ms, unlimited)
 *
 * @example
 * ```typescript
 * import { TieredStore, ageBasedPolicy } from 'dotdo/db/core/tiering'
 *
 * class CustomerStore extends TieredStore<Customer> {
 *   constructor(sql: SqlStorage, r2: R2Bucket) {
 *     super({
 *       policy: ageBasedPolicy(7, 90),
 *       r2Warm: r2,
 *     })
 *   }
 * }
 * ```
 */

import type { StorageTier, TieringPolicy, TierMetadata, TieredData, R2BucketLike, TierOperationResult } from './types'
import { createTierMetadata, updateAccessMetadata, createTieredData } from './types'
import { PolicyEvaluator } from './policy'
import { R2TierClient } from './r2-client'

// ============================================================================
// TIERED STORE BASE CLASS
// ============================================================================

/**
 * TieredStore - Base class for stores with automatic tiering
 *
 * Provides the infrastructure for three-tier storage:
 * - Hot tier operations (to be implemented by subclasses)
 * - Warm/cold tier operations via R2
 * - Policy-based tier evaluation
 *
 * @example
 * ```typescript
 * class DocumentStore extends TieredStore<Document> {
 *   constructor(options: TieredStoreOptions) {
 *     super(options)
 *   }
 *
 *   // Implement hot tier operations
 *   protected async getFromHot(key: string): Promise<TieredData<Document> | null> {
 *     const row = this.sql.exec('SELECT * FROM documents WHERE id = ?', key).one()
 *     if (!row) return null
 *     return { data: row.data, metadata: JSON.parse(row.metadata) }
 *   }
 *
 *   protected async putToHot(key: string, data: TieredData<Document>): Promise<void> {
 *     this.sql.exec(
 *       'INSERT OR REPLACE INTO documents (id, data, metadata) VALUES (?, ?, ?)',
 *       key, JSON.stringify(data.data), JSON.stringify(data.metadata)
 *     )
 *   }
 *
 *   protected async deleteFromHot(key: string): Promise<void> {
 *     this.sql.exec('DELETE FROM documents WHERE id = ?', key)
 *   }
 * }
 * ```
 */
export interface TieredStoreOptions {
  /** Tiering policy */
  policy: TieringPolicy
  /** R2 bucket for warm tier */
  r2Warm?: R2BucketLike
  /** R2 bucket for cold tier */
  r2Cold?: R2BucketLike
  /** Key prefix for R2 storage */
  keyPrefix?: string
}

export abstract class TieredStore<T> {
  protected policy: PolicyEvaluator
  protected r2Client: R2TierClient<T>

  constructor(options: TieredStoreOptions) {
    this.policy = new PolicyEvaluator(options.policy)
    this.r2Client = new R2TierClient<T>({
      warm: options.r2Warm,
      cold: options.r2Cold,
      keyPrefix: options.keyPrefix,
    })
  }

  // ============================================================================
  // ABSTRACT METHODS (implement in subclass)
  // ============================================================================

  /**
   * Get data from hot tier (DO SQLite)
   * @param key - Storage key
   */
  protected abstract getFromHot(key: string): Promise<TieredData<T> | null>

  /**
   * Put data to hot tier (DO SQLite)
   * @param key - Storage key
   * @param data - Tiered data with metadata
   */
  protected abstract putToHot(key: string, data: TieredData<T>): Promise<void>

  /**
   * Delete data from hot tier (DO SQLite)
   * @param key - Storage key
   */
  protected abstract deleteFromHot(key: string): Promise<void>

  /**
   * List keys in hot tier (for batch operations)
   * @param options - List options
   */
  protected abstract listHotKeys(options?: { prefix?: string; limit?: number }): Promise<string[]>

  /**
   * Get metadata for a hot tier key
   * @param key - Storage key
   */
  protected abstract getHotMetadata(key: string): Promise<TierMetadata | null>

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Get data from any tier (hot -> warm -> cold)
   *
   * @param key - Storage key
   * @returns Data and its current tier, or null if not found
   */
  async get(key: string): Promise<{ data: T; tier: StorageTier } | null> {
    // Try hot tier first
    const hotData = await this.getFromHot(key)
    if (hotData) {
      // Update access metadata
      await this.putToHot(key, {
        data: hotData.data,
        metadata: updateAccessMetadata(hotData.metadata),
      })
      return { data: hotData.data, tier: 'hot' }
    }

    // Try warm/cold tiers
    const { data: tieredData, tier } = await this.r2Client.getWithFallback(key)
    if (tieredData && tier) {
      return { data: tieredData.data, tier }
    }

    return null
  }

  /**
   * Put data into hot tier
   *
   * @param key - Storage key
   * @param data - Data to store
   */
  async put(key: string, data: T): Promise<void> {
    const tieredData = createTieredData(data, 'hot')
    await this.putToHot(key, tieredData)
  }

  /**
   * Delete data from all tiers
   *
   * @param key - Storage key
   */
  async delete(key: string): Promise<void> {
    await this.deleteFromHot(key)
    await this.r2Client.deleteFromAll(key)
  }

  /**
   * Tier data from hot to warm
   *
   * @param key - Storage key
   * @param data - Data to tier (if not provided, fetches from hot)
   */
  async tierToWarm(key: string, data?: T): Promise<TierOperationResult> {
    // Get data from hot if not provided
    let tieredData: TieredData<T> | null = null
    if (data !== undefined) {
      tieredData = createTieredData(data, 'warm')
    } else {
      const hotData = await this.getFromHot(key)
      if (!hotData) {
        return {
          success: false,
          key,
          error: 'Data not found in hot tier',
        }
      }
      tieredData = {
        data: hotData.data,
        metadata: { ...hotData.metadata, tier: 'warm' },
      }
    }

    // Write to warm tier
    const result = await this.r2Client.put('warm', key, tieredData.data, tieredData.metadata)

    if (result.success) {
      // Delete from hot tier
      await this.deleteFromHot(key)
      return {
        success: true,
        fromTier: 'hot',
        toTier: 'warm',
        key,
        durationMs: result.durationMs,
      }
    }

    return result
  }

  /**
   * Tier data from warm to cold
   *
   * @param key - Storage key
   */
  async tierToCold(key: string): Promise<TierOperationResult> {
    return this.r2Client.move(key, 'warm', 'cold')
  }

  /**
   * Fetch data from warm tier
   *
   * @param key - Storage key
   */
  async fetchFromWarm(key: string): Promise<T | null> {
    const data = await this.r2Client.get('warm', key)
    return data?.data ?? null
  }

  /**
   * Fetch data from cold tier
   *
   * @param key - Storage key
   */
  async fetchFromCold(key: string): Promise<T | null> {
    const data = await this.r2Client.get('cold', key)
    return data?.data ?? null
  }

  /**
   * Promote data from warm back to hot
   *
   * @param key - Storage key
   */
  async promoteToHot(key: string): Promise<TierOperationResult> {
    const warmData = await this.r2Client.get('warm', key)
    if (!warmData) {
      return {
        success: false,
        key,
        error: 'Data not found in warm tier',
      }
    }

    const startTime = Date.now()

    // Write to hot tier with updated metadata
    await this.putToHot(key, {
      data: warmData.data,
      metadata: { ...warmData.metadata, tier: 'hot' },
    })

    // Delete from warm tier
    await this.r2Client.delete('warm', key)

    return {
      success: true,
      fromTier: 'warm',
      toTier: 'hot',
      key,
      durationMs: Date.now() - startTime,
    }
  }

  /**
   * Restore data from cold to warm
   *
   * @param key - Storage key
   */
  async restoreFromCold(key: string): Promise<TierOperationResult> {
    return this.r2Client.move(key, 'cold', 'warm')
  }

  /**
   * Evaluate if data should be tiered based on policy
   *
   * @param metadata - Current tier metadata
   * @returns Target tier if tiering needed, null otherwise
   */
  shouldTier(metadata: TierMetadata): StorageTier | null {
    return this.policy.evaluate(metadata)
  }

  /**
   * Run tiering evaluation on all hot tier data
   *
   * @param options - Batch options
   * @returns Results of tiering operations
   */
  async runTieringBatch(options: { limit?: number; dryRun?: boolean } = {}): Promise<{
    evaluated: number
    tieredToWarm: number
    tieredToCold: number
    errors: number
    results: TierOperationResult[]
  }> {
    const limit = options.limit ?? 100
    const keys = await this.listHotKeys({ limit })

    const results: TierOperationResult[] = []
    let tieredToWarm = 0
    let tieredToCold = 0
    let errors = 0

    for (const key of keys) {
      const metadata = await this.getHotMetadata(key)
      if (!metadata) continue

      const targetTier = this.shouldTier(metadata)
      if (!targetTier) continue

      if (options.dryRun) {
        results.push({
          success: true,
          fromTier: metadata.tier,
          toTier: targetTier,
          key,
        })
        if (targetTier === 'warm') tieredToWarm++
        if (targetTier === 'cold') tieredToCold++
        continue
      }

      let result: TierOperationResult

      if (targetTier === 'warm') {
        result = await this.tierToWarm(key)
        if (result.success) tieredToWarm++
      } else if (targetTier === 'cold') {
        // For cold, first tier to warm then to cold
        const warmResult = await this.tierToWarm(key)
        if (warmResult.success) {
          result = await this.tierToCold(key)
          if (result.success) tieredToCold++
        } else {
          result = warmResult
        }
      } else {
        continue
      }

      if (!result.success) errors++
      results.push(result)
    }

    return {
      evaluated: keys.length,
      tieredToWarm,
      tieredToCold,
      errors,
      results,
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    hotKeys: number
    warmKeys: number
    coldKeys: number
  }> {
    const hotKeys = await this.listHotKeys()

    let warmKeys = 0
    let coldKeys = 0

    try {
      const warmList = await this.r2Client.list('warm')
      warmKeys = warmList.keys.length
    } catch {
      // Warm bucket may not be configured
    }

    try {
      const coldList = await this.r2Client.list('cold')
      coldKeys = coldList.keys.length
    } catch {
      // Cold bucket may not be configured
    }

    return {
      hotKeys: hotKeys.length,
      warmKeys,
      coldKeys,
    }
  }
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

// Types
export type {
  StorageTier,
  TieringPolicy,
  TierMetadata,
  TieredData,
  R2BucketLike,
  R2ObjectLike,
  R2PutOptions,
  R2ListOptions,
  R2ObjectsLike,
  TierOperationResult,
  BatchTierResult,
} from './types'

// Type utilities
export {
  STORAGE_TIERS,
  isStorageTier,
  DEFAULT_TIERING_POLICY,
  isValidTieringPolicy,
  createTierMetadata,
  updateAccessMetadata,
  createTieredData,
} from './types'

// Policy
export {
  PolicyEvaluator,
  ageBasedPolicy,
  accessBasedPolicy,
  combinedPolicy,
  customPolicy,
  PRESET_POLICIES,
  evaluateBatch,
  findTieringCandidates,
} from './policy'

// R2 client
export { R2TierClient, batchMove, batchDelete } from './r2-client'
