/**
 * TieredR2Storage - R2-backed tiered storage with automatic tier migration
 *
 * Implements hot/warm/cold tiers based on access patterns:
 * - Hot: Recently accessed (< 1 day by default)
 * - Warm: Moderately accessed (< 30 days by default)
 * - Cold: Infrequently accessed (> 30 days by default)
 *
 * Features:
 * - Automatic tier migration based on access patterns
 * - Configurable tier policies
 * - Access tracking for intelligent placement
 * - Cost optimization through tier demotion
 * - Performance optimization through tier promotion
 */

import type { StorageTier } from '../core/index.js'

/**
 * Time duration constants in milliseconds
 */
const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * Default tier policy thresholds
 */
const DEFAULT_HOT_THRESHOLD_DAYS = 1
const DEFAULT_WARM_THRESHOLD_DAYS = 30

/**
 * Tier policy configuration
 */
export interface TierPolicy {
  /** Maximum age in days for hot tier (default: 1 day) */
  hotMaxAgeDays: number
  /** Maximum age in days for warm tier (default: 30 days) */
  warmMaxAgeDays: number
  /** Enable automatic promotion on access (default: true) */
  autoPromote: boolean
  /** Enable automatic demotion based on age (default: true) */
  autoDemote: boolean
  /** Minimum size for cold tier consideration in bytes (default: 0) */
  coldMinSize: number
}

/**
 * Default tier policy
 */
const DEFAULT_TIER_POLICY: TierPolicy = {
  hotMaxAgeDays: DEFAULT_HOT_THRESHOLD_DAYS,
  warmMaxAgeDays: DEFAULT_WARM_THRESHOLD_DAYS,
  autoPromote: true,
  autoDemote: true,
  coldMinSize: 0,
}

/**
 * Configuration for TieredR2Storage
 */
export interface TieredR2StorageConfig {
  /** Hot tier R2 bucket (fast access, higher cost) */
  hotBucket: R2Bucket
  /** Warm tier R2 bucket (balanced, optional - uses hot if not provided) */
  warmBucket?: R2Bucket
  /** Cold tier R2 bucket (slow access, lowest cost, optional - uses warm/hot if not provided) */
  coldBucket?: R2Bucket
  /** Key prefix for all objects */
  prefix?: string
  /** Tier policy configuration */
  policy?: Partial<TierPolicy>
  /** SQLite storage for metadata (for Durable Object context) */
  sql?: SqlStorage
}

/**
 * File metadata stored in R2 custom metadata
 */
export interface TieredFileMetadata {
  /** Current storage tier */
  tier: StorageTier
  /** Last access timestamp (Unix ms) */
  lastAccess: number
  /** Access count for analytics */
  accessCount: number
  /** Original creation timestamp */
  createdAt: number
  /** Content hash for deduplication */
  contentHash?: string
  /** Original filename/path */
  originalPath?: string
}

/**
 * Result of a tiered storage operation
 */
export interface TieredStorageResult {
  /** The storage tier used */
  tier: StorageTier
  /** Whether a tier migration occurred */
  migrated: boolean
  /** Previous tier (if migrated) */
  previousTier?: StorageTier
}

/**
 * Result of a read operation
 */
export interface TieredReadResult extends TieredStorageResult {
  /** The file data */
  data: Uint8Array
  /** R2 object metadata */
  metadata: R2Object
}

/**
 * Result of a write operation
 */
export interface TieredWriteResult extends TieredStorageResult {
  /** ETag of the stored object */
  etag: string
  /** Size of the stored data */
  size: number
}

/**
 * Access metadata row for SQLite tracking
 */
interface AccessMetadataRow {
  key: string
  tier: string
  last_access: number
  access_count: number
  size: number
  created_at: number
  [key: string]: SqlStorageValue
}

/**
 * TieredR2Storage - Intelligent tiered storage using R2
 *
 * Automatically manages file placement across hot/warm/cold tiers
 * based on access patterns and configurable policies.
 *
 * @example
 * ```typescript
 * const storage = new TieredR2Storage({
 *   hotBucket: env.R2_HOT,
 *   warmBucket: env.R2_WARM,
 *   coldBucket: env.R2_COLD,
 *   policy: {
 *     hotMaxAgeDays: 1,
 *     warmMaxAgeDays: 30,
 *     autoPromote: true,
 *     autoDemote: true,
 *   }
 * })
 *
 * // Write - automatically placed in appropriate tier
 * await storage.put('/data/file.json', data)
 *
 * // Read - automatically promoted if frequently accessed
 * const result = await storage.get('/data/file.json')
 * console.log(`Read from ${result.tier} tier`)
 *
 * // Manual tier management
 * await storage.promote('/data/important.json', 'hot')
 * await storage.demote('/data/archive.json', 'cold')
 * ```
 */
export class TieredR2Storage {
  private hotBucket: R2Bucket
  private warmBucket: R2Bucket
  private coldBucket: R2Bucket
  private prefix: string
  private policy: TierPolicy
  private sql?: SqlStorage
  private initialized = false

  constructor(config: TieredR2StorageConfig) {
    this.hotBucket = config.hotBucket
    this.warmBucket = config.warmBucket ?? config.hotBucket
    this.coldBucket = config.coldBucket ?? config.warmBucket ?? config.hotBucket
    this.prefix = config.prefix ?? ''
    this.policy = { ...DEFAULT_TIER_POLICY, ...config.policy }
    this.sql = config.sql
  }

  /**
   * Initialize metadata tracking table if SQL storage is available
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized || !this.sql) return

    await this.sql.exec(`
      CREATE TABLE IF NOT EXISTS tiered_access_metadata (
        key TEXT PRIMARY KEY,
        tier TEXT NOT NULL DEFAULT 'hot' CHECK(tier IN ('hot', 'warm', 'cold')),
        last_access INTEGER NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        size INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tiered_tier ON tiered_access_metadata(tier);
      CREATE INDEX IF NOT EXISTS idx_tiered_last_access ON tiered_access_metadata(last_access);
    `)

    this.initialized = true
  }

  /**
   * Get full key with prefix
   */
  private key(path: string): string {
    return this.prefix + path
  }

  /**
   * Get the R2 bucket for a given tier
   */
  private getBucket(tier: StorageTier): R2Bucket {
    switch (tier) {
      case 'hot':
        return this.hotBucket
      case 'warm':
        return this.warmBucket
      case 'cold':
        return this.coldBucket
    }
  }

  /**
   * Determine the appropriate tier based on access pattern
   * @internal Reserved for automatic tier migration based on access patterns
   */
  // Reserved for future tier migration implementation
  // @ts-expect-error Reserved for future tier migration
  private _determineTierByAge(lastAccess: number, now: number = Date.now()): StorageTier {
    const ageMs = now - lastAccess
    const ageDays = ageMs / MS_PER_DAY

    if (ageDays < this.policy.hotMaxAgeDays) {
      return 'hot'
    } else if (ageDays < this.policy.warmMaxAgeDays) {
      return 'warm'
    } else {
      return 'cold'
    }
  }

  /**
   * Parse tier metadata from R2 custom metadata
   */
  private parseMetadata(customMetadata: Record<string, string> | undefined): TieredFileMetadata | null {
    if (!customMetadata) return null

    try {
      return {
        tier: (customMetadata['x-tier'] as StorageTier) ?? 'hot',
        lastAccess: parseInt(customMetadata['x-last-access'] ?? '0', 10),
        accessCount: parseInt(customMetadata['x-access-count'] ?? '0', 10),
        createdAt: parseInt(customMetadata['x-created-at'] ?? '0', 10),
        contentHash: customMetadata['x-content-hash'],
        originalPath: customMetadata['x-original-path'],
      }
    } catch {
      return null
    }
  }

  /**
   * Create tier metadata for R2 custom metadata
   */
  private createMetadata(tier: StorageTier, existingMeta?: TieredFileMetadata | null, path?: string): Record<string, string> {
    const now = Date.now()
    return {
      'x-tier': tier,
      'x-last-access': String(now),
      'x-access-count': String((existingMeta?.accessCount ?? 0) + 1),
      'x-created-at': String(existingMeta?.createdAt ?? now),
      'x-original-path': path ?? existingMeta?.originalPath ?? '',
    }
  }

  /**
   * Update access metadata in SQLite
   */
  private async updateAccessMetadata(key: string, tier: StorageTier, size: number): Promise<void> {
    if (!this.sql) return

    await this.ensureInitialized()

    const now = Date.now()
    const existing = await this.sql.exec<AccessMetadataRow>('SELECT * FROM tiered_access_metadata WHERE key = ?', key).one()

    if (existing) {
      await this.sql.exec(
        'UPDATE tiered_access_metadata SET tier = ?, last_access = ?, access_count = access_count + 1, size = ? WHERE key = ?',
        tier,
        now,
        size,
        key
      )
    } else {
      await this.sql.exec(
        'INSERT INTO tiered_access_metadata (key, tier, last_access, access_count, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        key,
        tier,
        now,
        1,
        size,
        now
      )
    }
  }

  /**
   * Get access metadata from SQLite
   * @internal Reserved for future tier migration based on access patterns
   */
  // Reserved for future tier migration implementation
  // @ts-expect-error Reserved for future tier migration
  private async _getAccessMetadata(key: string): Promise<AccessMetadataRow | null> {
    if (!this.sql) return null

    await this.ensureInitialized()
    return this.sql.exec<AccessMetadataRow>('SELECT * FROM tiered_access_metadata WHERE key = ?', key).one()
  }

  /**
   * Store a file with automatic tier selection
   *
   * @param path - File path/key
   * @param data - File data
   * @param options - Storage options
   * @returns Write result with tier information
   */
  async put(
    path: string,
    data: Uint8Array | ReadableStream,
    options?: {
      contentType?: string
      tier?: StorageTier
      customMetadata?: Record<string, string>
    }
  ): Promise<TieredWriteResult> {
    const key = this.key(path)
    void Date.now() // Timestamp available for future tracking

    // Determine initial tier
    const tier = options?.tier ?? 'hot'
    const bucket = this.getBucket(tier)

    // Create metadata
    const metadata = this.createMetadata(tier, null, path)
    const combinedMetadata = { ...metadata, ...(options?.customMetadata ?? {}) }

    // Store the object
    const object = await bucket.put(key, data, {
      httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
      customMetadata: combinedMetadata,
    })

    // Update SQLite tracking
    await this.updateAccessMetadata(key, tier, object.size)

    return {
      tier,
      migrated: false,
      etag: object.etag,
      size: object.size,
    }
  }

  /**
   * Retrieve a file with automatic tier promotion
   *
   * @param path - File path/key
   * @returns Read result with data and tier information
   */
  async get(path: string): Promise<TieredReadResult | null> {
    const key = this.key(path)

    // Track which buckets we've already checked (for when same bucket is used for multiple tiers)
    const checkedBuckets = new Set<R2Bucket>()

    // Try to find the object in each tier, starting with hot
    for (const tier of ['hot', 'warm', 'cold'] as StorageTier[]) {
      const bucket = this.getBucket(tier)

      // Skip if we've already checked this bucket
      if (checkedBuckets.has(bucket)) {
        continue
      }
      checkedBuckets.add(bucket)

      const object = await bucket.get(key)

      if (object) {
        const data = new Uint8Array(await object.arrayBuffer())
        const existingMeta = this.parseMetadata(object.customMetadata)

        // Use the tier from metadata if available, otherwise use the bucket's tier
        const actualTier = existingMeta?.tier ?? tier

        // Update access metadata
        await this.updateAccessMetadata(key, actualTier, data.length)

        // Check if promotion is needed
        if (this.policy.autoPromote && actualTier !== 'hot') {
          const shouldPromote = this.shouldPromote(existingMeta)
          if (shouldPromote) {
            const newTier = actualTier === 'cold' ? 'warm' : 'hot'
            await this.migrateInternal(key, data, actualTier, newTier, existingMeta, object.httpMetadata)

            return {
              data,
              metadata: object,
              tier: newTier,
              migrated: true,
              previousTier: actualTier,
            }
          }
        }

        // Update last access metadata in place
        const updatedMeta = this.createMetadata(actualTier, existingMeta, path)
        await bucket.put(key, data, {
          httpMetadata: object.httpMetadata,
          customMetadata: updatedMeta,
        })

        return {
          data,
          metadata: object,
          tier: actualTier,
          migrated: false,
        }
      }
    }

    return null
  }

  /**
   * Get a file as a stream
   */
  async getStream(path: string): Promise<{ stream: ReadableStream; metadata: R2Object; tier: StorageTier } | null> {
    const key = this.key(path)

    for (const tier of ['hot', 'warm', 'cold'] as StorageTier[]) {
      const bucket = this.getBucket(tier)
      const object = await bucket.get(key)

      if (object) {
        // Update access tracking
        await this.updateAccessMetadata(key, tier, object.size)
        return { stream: object.body, metadata: object, tier }
      }
    }

    return null
  }

  /**
   * Get a range of bytes from a file
   */
  async getRange(
    path: string,
    start: number,
    end?: number
  ): Promise<{ data: Uint8Array; metadata: R2Object; tier: StorageTier } | null> {
    const key = this.key(path)
    const range = end !== undefined ? { offset: start, length: end - start + 1 } : { offset: start }

    for (const tier of ['hot', 'warm', 'cold'] as StorageTier[]) {
      const bucket = this.getBucket(tier)
      const object = await bucket.get(key, { range })

      if (object) {
        const data = new Uint8Array(await object.arrayBuffer())
        await this.updateAccessMetadata(key, tier, object.size)
        return { data, metadata: object, tier }
      }
    }

    return null
  }

  /**
   * Check if a file exists
   */
  async exists(path: string): Promise<{ exists: boolean; tier?: StorageTier }> {
    const key = this.key(path)
    const checkedBuckets = new Set<R2Bucket>()

    for (const tier of ['hot', 'warm', 'cold'] as StorageTier[]) {
      const bucket = this.getBucket(tier)

      if (checkedBuckets.has(bucket)) {
        continue
      }
      checkedBuckets.add(bucket)

      const object = await bucket.head(key)

      if (object) {
        // Use tier from metadata if available
        const existingMeta = this.parseMetadata(object.customMetadata)
        const actualTier = existingMeta?.tier ?? tier
        return { exists: true, tier: actualTier }
      }
    }

    return { exists: false }
  }

  /**
   * Get file metadata without downloading
   */
  async head(path: string): Promise<{ metadata: R2Object; tier: StorageTier } | null> {
    const key = this.key(path)
    const checkedBuckets = new Set<R2Bucket>()

    for (const tier of ['hot', 'warm', 'cold'] as StorageTier[]) {
      const bucket = this.getBucket(tier)

      if (checkedBuckets.has(bucket)) {
        continue
      }
      checkedBuckets.add(bucket)

      const object = await bucket.head(key)

      if (object) {
        // Use tier from metadata if available
        const existingMeta = this.parseMetadata(object.customMetadata)
        const actualTier = existingMeta?.tier ?? tier
        return { metadata: object, tier: actualTier }
      }
    }

    return null
  }

  /**
   * Delete a file from all tiers
   */
  async delete(path: string): Promise<void> {
    const key = this.key(path)

    // Delete from all tiers to ensure cleanup
    await Promise.all([this.hotBucket.delete(key), this.warmBucket.delete(key), this.coldBucket.delete(key)])

    // Remove from SQLite tracking
    if (this.sql) {
      await this.ensureInitialized()
      await this.sql.exec('DELETE FROM tiered_access_metadata WHERE key = ?', key)
    }
  }

  /**
   * Delete multiple files
   */
  async deleteMany(paths: string[]): Promise<void> {
    const keys = paths.map((p) => this.key(p))

    // Delete from all tiers
    await Promise.all([this.hotBucket.delete(keys), this.warmBucket.delete(keys), this.coldBucket.delete(keys)])

    // Remove from SQLite tracking
    if (this.sql && keys.length > 0) {
      await this.ensureInitialized()
      const placeholders = keys.map(() => '?').join(',')
      await this.sql.exec(`DELETE FROM tiered_access_metadata WHERE key IN (${placeholders})`, ...keys)
    }
  }

  /**
   * Determine if a file should be promoted based on access pattern
   */
  private shouldPromote(metadata: TieredFileMetadata | null): boolean {
    if (!metadata) return false

    const now = Date.now()
    const ageMs = now - metadata.lastAccess
    const ageDays = ageMs / MS_PER_DAY

    // Promote if accessed recently (within hot threshold)
    if (ageDays < this.policy.hotMaxAgeDays) {
      return true
    }

    // Promote if accessed frequently (more than 5 times in warm period)
    if (metadata.accessCount > 5 && ageDays < this.policy.warmMaxAgeDays) {
      return true
    }

    return false
  }

  /**
   * Internal migration between tiers
   */
  private async migrateInternal(
    key: string,
    data: Uint8Array,
    fromTier: StorageTier,
    toTier: StorageTier,
    existingMeta: TieredFileMetadata | null,
    httpMetadata?: R2HTTPMetadata
  ): Promise<void> {
    const toBucket = this.getBucket(toTier)
    const fromBucket = this.getBucket(fromTier)

    // Create updated metadata
    const metadata = this.createMetadata(toTier, existingMeta)

    // Write to new tier
    await toBucket.put(key, data, {
      httpMetadata,
      customMetadata: metadata,
    })

    // Delete from old tier (only if different buckets)
    if (toBucket !== fromBucket) {
      await fromBucket.delete(key)
    }

    // Update SQLite tracking
    await this.updateAccessMetadata(key, toTier, data.length)
  }

  /**
   * Manually promote a file to a higher tier
   *
   * @param path - File path
   * @param targetTier - Target tier ('hot' or 'warm')
   */
  async promote(path: string, targetTier: 'hot' | 'warm'): Promise<TieredStorageResult> {
    const key = this.key(path)
    const checkedBuckets = new Set<R2Bucket>()

    // Find current location by checking all unique buckets
    for (const tier of ['hot', 'warm', 'cold'] as StorageTier[]) {
      const bucket = this.getBucket(tier)

      if (checkedBuckets.has(bucket)) {
        continue
      }
      checkedBuckets.add(bucket)

      const object = await bucket.get(key)

      if (object) {
        const data = new Uint8Array(await object.arrayBuffer())
        const existingMeta = this.parseMetadata(object.customMetadata)

        // Use tier from metadata if available
        const currentTier = existingMeta?.tier ?? tier

        // Check if already at or above target tier
        if (currentTier === targetTier) {
          return { tier: currentTier, migrated: false }
        }
        if (targetTier === 'warm' && currentTier === 'hot') {
          return { tier: currentTier, migrated: false }
        }

        await this.migrateInternal(key, data, currentTier, targetTier, existingMeta, object.httpMetadata)

        return {
          tier: targetTier,
          migrated: true,
          previousTier: currentTier,
        }
      }
    }

    throw new Error(`File not found: ${path}`)
  }

  /**
   * Manually demote a file to a lower tier
   *
   * @param path - File path
   * @param targetTier - Target tier ('warm' or 'cold')
   */
  async demote(path: string, targetTier: 'warm' | 'cold'): Promise<TieredStorageResult> {
    const key = this.key(path)
    const checkedBuckets = new Set<R2Bucket>()

    // Find current location by checking all unique buckets
    for (const tier of ['hot', 'warm', 'cold'] as StorageTier[]) {
      const bucket = this.getBucket(tier)

      if (checkedBuckets.has(bucket)) {
        continue
      }
      checkedBuckets.add(bucket)

      const object = await bucket.get(key)

      if (object) {
        const data = new Uint8Array(await object.arrayBuffer())
        const existingMeta = this.parseMetadata(object.customMetadata)

        // Use tier from metadata if available
        const currentTier = existingMeta?.tier ?? tier

        // Check if already at or below target tier
        if (currentTier === targetTier) {
          return { tier: currentTier, migrated: false }
        }
        if (targetTier === 'warm' && currentTier === 'cold') {
          return { tier: currentTier, migrated: false }
        }

        await this.migrateInternal(key, data, currentTier, targetTier, existingMeta, object.httpMetadata)

        return {
          tier: targetTier,
          migrated: true,
          previousTier: currentTier,
        }
      }
    }

    throw new Error(`File not found: ${path}`)
  }

  /**
   * Get the current tier for a file
   */
  async getTier(path: string): Promise<StorageTier | null> {
    const result = await this.exists(path)
    return result.tier ?? null
  }

  /**
   * Run automatic tier migration based on access patterns
   *
   * This should be called periodically (e.g., via cron) to demote
   * infrequently accessed files to lower tiers.
   *
   * @param options - Migration options
   * @returns Number of files migrated
   */
  async runMigration(options?: { dryRun?: boolean; limit?: number }): Promise<{
    promoted: number
    demoted: number
    errors: string[]
  }> {
    if (!this.sql) {
      return { promoted: 0, demoted: 0, errors: ['SQLite storage not available for migration'] }
    }

    await this.ensureInitialized()

    const now = Date.now()
    const hotThreshold = now - this.policy.hotMaxAgeDays * MS_PER_DAY
    const warmThreshold = now - this.policy.warmMaxAgeDays * MS_PER_DAY
    const limit = options?.limit ?? 100

    let promoted = 0
    let demoted = 0
    const errors: string[] = []

    // Find files to demote from hot to warm
    const hotToWarm = this.sql
      .exec<AccessMetadataRow>('SELECT * FROM tiered_access_metadata WHERE tier = ? AND last_access < ? LIMIT ?', 'hot', hotThreshold, limit)
      .toArray()

    for (const row of hotToWarm) {
      try {
        if (!options?.dryRun) {
          await this.demote(row.key.replace(this.prefix, ''), 'warm')
        }
        demoted++
      } catch (e) {
        errors.push(`Failed to demote ${row.key}: ${e}`)
      }
    }

    // Find files to demote from warm to cold
    const warmToCold = this.sql
      .exec<AccessMetadataRow>('SELECT * FROM tiered_access_metadata WHERE tier = ? AND last_access < ? LIMIT ?', 'warm', warmThreshold, limit)
      .toArray()

    for (const row of warmToCold) {
      try {
        if (!options?.dryRun) {
          await this.demote(row.key.replace(this.prefix, ''), 'cold')
        }
        demoted++
      } catch (e) {
        errors.push(`Failed to demote ${row.key}: ${e}`)
      }
    }

    return { promoted, demoted, errors }
  }

  /**
   * Get storage statistics by tier
   */
  async getStats(): Promise<{
    hot: { count: number; totalSize: number }
    warm: { count: number; totalSize: number }
    cold: { count: number; totalSize: number }
  }> {
    if (!this.sql) {
      return {
        hot: { count: 0, totalSize: 0 },
        warm: { count: 0, totalSize: 0 },
        cold: { count: 0, totalSize: 0 },
      }
    }

    await this.ensureInitialized()

    const stats = this.sql
      .exec<{ tier: string; count: number; total_size: number }>(
        'SELECT tier, COUNT(*) as count, SUM(size) as total_size FROM tiered_access_metadata GROUP BY tier'
      )
      .toArray()

    const result = {
      hot: { count: 0, totalSize: 0 },
      warm: { count: 0, totalSize: 0 },
      cold: { count: 0, totalSize: 0 },
    }

    for (const row of stats) {
      const tier = row.tier as StorageTier
      result[tier] = { count: row.count, totalSize: row.total_size ?? 0 }
    }

    return result
  }

  /**
   * List files in a specific tier
   */
  async listByTier(
    tier: StorageTier,
    options?: { prefix?: string; limit?: number; cursor?: string }
  ): Promise<{
    objects: R2Object[]
    cursor?: string
    truncated: boolean
  }> {
    const bucket = this.getBucket(tier)
    const fullPrefix = options?.prefix ? this.key(options.prefix) : this.prefix

    return bucket.list({
      prefix: fullPrefix,
      limit: options?.limit,
      cursor: options?.cursor,
    })
  }

  /**
   * Copy a file within tiers
   */
  async copy(sourcePath: string, destPath: string, destTier?: StorageTier): Promise<TieredWriteResult> {
    const result = await this.get(sourcePath)
    if (!result) {
      throw new Error(`Source not found: ${sourcePath}`)
    }

    const tier = destTier ?? result.tier
    return this.put(destPath, result.data, { tier })
  }
}
