/**
 * @fileoverview R2 Tiered Storage for GitModule
 *
 * This module provides tiered storage support for Git objects in the GitModule,
 * implementing a three-tier architecture:
 *
 * - **Hot tier**: SQLite in Durable Object (fastest access, limited capacity)
 * - **Warm tier**: R2 loose objects (medium latency, larger capacity)
 * - **Cold tier**: R2 packfiles (highest latency, most efficient storage)
 *
 * The module automatically:
 * - Promotes frequently accessed objects to the hot tier
 * - Demotes old/rarely accessed objects to warm/cold tiers
 * - Supports packfile storage in R2 for efficiency
 *
 * @module do/tiered-storage
 *
 * @example
 * ```typescript
 * import { TieredStorage } from 'gitx.do/do'
 *
 * const storage = new TieredStorage({
 *   r2: env.R2_BUCKET,
 *   sql: ctx.storage.sql,
 *   prefix: 'git/objects',
 *   hotTierMaxBytes: 50 * 1024 * 1024, // 50MB in SQLite
 *   promotionThreshold: 3, // Promote after 3 accesses
 *   demotionAgeDays: 7 // Demote after 7 days without access
 * })
 *
 * // Get an object (checks hot -> warm -> cold)
 * const obj = await storage.getObject(sha)
 *
 * // Store an object (goes to appropriate tier based on size/frequency)
 * await storage.putObject(sha, type, data)
 * ```
 */

import type { ObjectType } from '../types/objects'

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * R2 Bucket interface for object storage operations.
 */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: R2PutOptions): Promise<R2ObjectLike>
  delete(key: string | string[]): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectsLike>
  head(key: string): Promise<R2ObjectLike | null>
}

/**
 * R2 Put options interface.
 */
export interface R2PutOptions {
  customMetadata?: Record<string, string>
}

/**
 * R2 Object interface.
 */
export interface R2ObjectLike {
  key: string
  size: number
  customMetadata?: Record<string, string>
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

/**
 * R2 Objects list result interface.
 */
export interface R2ObjectsLike {
  objects: R2ObjectLike[]
  truncated: boolean
  cursor?: string
}

/**
 * SQL interface for Durable Object storage.
 */
export interface SqlStorage {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
}

/**
 * Storage tier enumeration.
 */
export type StorageTier = 'hot' | 'warm' | 'cold'

/**
 * Object metadata stored in SQLite for tracking.
 */
export interface ObjectMetadata {
  sha: string
  type: ObjectType
  size: number
  tier: StorageTier
  accessCount: number
  lastAccessed: number
  createdAt: number
  packId?: string
  packOffset?: number
}

/**
 * Configuration options for TieredStorage.
 */
export interface TieredStorageOptions {
  /**
   * R2 bucket for warm and cold storage.
   */
  r2: R2BucketLike

  /**
   * SQL storage interface for hot tier and metadata.
   */
  sql: SqlStorage

  /**
   * Key prefix for R2 objects.
   * @default 'git/objects'
   */
  prefix?: string

  /**
   * Maximum bytes to store in the hot tier (SQLite).
   * @default 50 * 1024 * 1024 (50MB)
   */
  hotTierMaxBytes?: number

  /**
   * Number of accesses before promoting to hot tier.
   * @default 3
   */
  promotionThreshold?: number

  /**
   * Days without access before demoting to colder tier.
   * @default 7
   */
  demotionAgeDays?: number

  /**
   * Maximum object size to store in hot tier.
   * @default 1 * 1024 * 1024 (1MB)
   */
  hotTierMaxObjectSize?: number

  /**
   * Enable automatic promotion on access.
   * @default true
   */
  autoPromote?: boolean

  /**
   * Enable automatic demotion of old objects.
   * @default true
   */
  autoDemote?: boolean
}

/**
 * Result of a get operation.
 */
export interface GetObjectResult {
  type: ObjectType
  data: Uint8Array
  tier: StorageTier
  promoted: boolean
}

/**
 * Statistics about the tiered storage.
 */
export interface TieredStorageStats {
  hotTierCount: number
  hotTierBytes: number
  warmTierCount: number
  coldTierCount: number
  totalObjects: number
  cacheHitRate: number
  promotions: number
  demotions: number
}

// ============================================================================
// TieredStorage Class
// ============================================================================

/**
 * TieredStorage - R2 Tiered Storage for GitModule
 *
 * @description
 * Provides a three-tier storage system for Git objects optimized for
 * Cloudflare Workers with Durable Objects:
 *
 * - **Hot tier**: SQLite blob storage in Durable Object
 *   - Fastest access (local to DO)
 *   - Limited capacity (50MB default)
 *   - For frequently accessed objects
 *
 * - **Warm tier**: R2 loose objects
 *   - Medium latency (~50-100ms)
 *   - Unlimited capacity
 *   - For recently accessed objects
 *
 * - **Cold tier**: R2 packfiles
 *   - Highest latency (requires packfile parsing)
 *   - Most storage efficient
 *   - For archived/rarely accessed objects
 *
 * @example
 * ```typescript
 * const storage = new TieredStorage({
 *   r2: env.GIT_OBJECTS,
 *   sql: ctx.storage.sql,
 *   prefix: 'repos/my-repo/objects'
 * })
 *
 * // Store a new object
 * await storage.putObject('abc123...', 'blob', blobData)
 *
 * // Retrieve an object (auto-promotes on frequent access)
 * const result = await storage.getObject('abc123...')
 * console.log(`Found in ${result.tier} tier, promoted: ${result.promoted}`)
 *
 * // Run maintenance (demotes old objects)
 * await storage.runMaintenance()
 * ```
 */
export class TieredStorage {
  private readonly r2: R2BucketLike
  private readonly sql: SqlStorage
  private readonly prefix: string
  private readonly hotTierMaxBytes: number
  private readonly promotionThreshold: number
  private readonly demotionAgeDays: number
  private readonly hotTierMaxObjectSize: number
  private readonly autoPromote: boolean
  private readonly autoDemote: boolean

  // Statistics tracking
  private hotHits = 0
  private warmHits = 0
  private coldHits = 0
  private misses = 0
  private promotions = 0
  private demotions = 0

  // Schema initialization flag
  private initialized = false

  /**
   * Creates a new TieredStorage instance.
   *
   * @param options - Configuration options
   */
  constructor(options: TieredStorageOptions) {
    this.r2 = options.r2
    this.sql = options.sql
    this.prefix = options.prefix ?? 'git/objects'
    this.hotTierMaxBytes = options.hotTierMaxBytes ?? 50 * 1024 * 1024
    this.promotionThreshold = options.promotionThreshold ?? 3
    this.demotionAgeDays = options.demotionAgeDays ?? 7
    this.hotTierMaxObjectSize = options.hotTierMaxObjectSize ?? 1 * 1024 * 1024
    this.autoPromote = options.autoPromote ?? true
    this.autoDemote = options.autoDemote ?? true
  }

  /**
   * Initialize the SQLite schema for tiered storage.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create object metadata table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS git_objects_meta (
        sha TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        size INTEGER NOT NULL,
        tier TEXT NOT NULL DEFAULT 'warm',
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        pack_id TEXT,
        pack_offset INTEGER
      )
    `)

    // Create hot tier blob storage table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS git_objects_hot (
        sha TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data BLOB NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)

    // Create index for efficient queries
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_git_objects_meta_tier
      ON git_objects_meta(tier)
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_git_objects_meta_last_accessed
      ON git_objects_meta(last_accessed)
    `)

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_git_objects_meta_access_count
      ON git_objects_meta(access_count)
    `)

    this.initialized = true
  }

  /**
   * Get an object from the tiered storage.
   *
   * @description
   * Attempts to retrieve the object from each tier in order:
   * 1. Hot tier (SQLite)
   * 2. Warm tier (R2 loose objects)
   * 3. Cold tier (R2 packfiles)
   *
   * Automatically promotes frequently accessed objects to hotter tiers.
   *
   * @param sha - 40-character SHA-1 hash of the object
   * @returns Object data with tier information, or null if not found
   */
  async getObject(sha: string): Promise<GetObjectResult | null> {
    await this.initialize()

    // Try hot tier first (SQLite)
    const hotResult = await this.getFromHotTier(sha)
    if (hotResult) {
      this.hotHits++
      await this.recordAccess(sha)
      return {
        type: hotResult.type,
        data: hotResult.data,
        tier: 'hot',
        promoted: false
      }
    }

    // Get metadata to determine tier
    const meta = await this.getMetadata(sha)

    // Try warm tier (R2 loose objects)
    const warmResult = await this.getFromWarmTier(sha)
    if (warmResult) {
      this.warmHits++
      await this.recordAccess(sha)

      // Check for promotion
      let promoted = false
      if (this.autoPromote && meta && meta.accessCount >= this.promotionThreshold) {
        promoted = await this.promoteToHot(sha, warmResult.type, warmResult.data)
      }

      return {
        type: warmResult.type,
        data: warmResult.data,
        tier: 'warm',
        promoted
      }
    }

    // Try cold tier (R2 packfiles)
    if (meta?.packId && meta.packOffset !== undefined) {
      const coldResult = await this.getFromColdTier(meta.packId, meta.packOffset)
      if (coldResult) {
        this.coldHits++
        await this.recordAccess(sha)

        // Check for promotion
        let promoted = false
        if (this.autoPromote && meta.accessCount >= this.promotionThreshold) {
          // Promote to warm first (not hot, since it came from cold)
          await this.promoteToWarm(sha, coldResult.type, coldResult.data)
          promoted = true
        }

        return {
          type: coldResult.type,
          data: coldResult.data,
          tier: 'cold',
          promoted
        }
      }
    }

    this.misses++
    return null
  }

  /**
   * Store an object in the tiered storage.
   *
   * @description
   * Stores the object in the appropriate tier based on size and configuration:
   * - Small, new objects go to hot tier if capacity allows
   * - Large objects go directly to warm tier
   *
   * @param sha - 40-character SHA-1 hash
   * @param type - Git object type
   * @param data - Raw object data
   * @returns The tier where the object was stored
   */
  async putObject(sha: string, type: ObjectType, data: Uint8Array): Promise<StorageTier> {
    await this.initialize()

    const size = data.length
    const now = Date.now()

    // Check if object already exists
    const existing = await this.getMetadata(sha)
    if (existing) {
      return existing.tier
    }

    // Determine target tier based on size and capacity
    let tier: StorageTier = 'warm'

    if (size <= this.hotTierMaxObjectSize) {
      const currentHotBytes = await this.getHotTierBytes()
      if (currentHotBytes + size <= this.hotTierMaxBytes) {
        tier = 'hot'
      }
    }

    // Store in appropriate tier
    if (tier === 'hot') {
      await this.storeInHotTier(sha, type, data)
    } else {
      await this.storeInWarmTier(sha, type, data)
    }

    // Record metadata
    this.sql.exec(
      `INSERT INTO git_objects_meta (sha, type, size, tier, access_count, last_accessed, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      sha, type, size, tier, now, now
    )

    return tier
  }

  /**
   * Check if an object exists in any tier.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns True if object exists
   */
  async hasObject(sha: string): Promise<boolean> {
    await this.initialize()

    const meta = await this.getMetadata(sha)
    return meta !== null
  }

  /**
   * Delete an object from all tiers.
   *
   * @param sha - 40-character SHA-1 hash
   */
  async deleteObject(sha: string): Promise<void> {
    await this.initialize()

    const meta = await this.getMetadata(sha)
    if (!meta) return

    // Delete from hot tier
    this.sql.exec('DELETE FROM git_objects_hot WHERE sha = ?', sha)

    // Delete from warm tier (R2)
    const key = this.buildR2Key(sha)
    await this.r2.delete(key)

    // Delete metadata
    this.sql.exec('DELETE FROM git_objects_meta WHERE sha = ?', sha)
  }

  /**
   * Manually promote an object to the hot tier.
   *
   * @param sha - Object SHA to promote
   * @param type - Object type
   * @param data - Object data
   * @returns True if promotion succeeded
   */
  async promoteToHot(sha: string, type: ObjectType, data: Uint8Array): Promise<boolean> {
    await this.initialize()

    const size = data.length

    // Check if object fits in hot tier
    if (size > this.hotTierMaxObjectSize) {
      return false
    }

    const currentBytes = await this.getHotTierBytes()
    if (currentBytes + size > this.hotTierMaxBytes) {
      // Need to evict objects to make room
      const evicted = await this.evictFromHotTier(size)
      if (!evicted) {
        return false
      }
    }

    // Store in hot tier
    await this.storeInHotTier(sha, type, data)

    // Update metadata
    this.sql.exec(
      'UPDATE git_objects_meta SET tier = ? WHERE sha = ?',
      'hot', sha
    )

    this.promotions++
    return true
  }

  /**
   * Demote an object from hot to warm tier.
   *
   * @param sha - Object SHA to demote
   */
  async demoteToWarm(sha: string): Promise<void> {
    await this.initialize()

    // Get object from hot tier
    const rows = this.sql.exec(
      'SELECT type, data FROM git_objects_hot WHERE sha = ?',
      sha
    ).toArray() as Array<{ type: string; data: Uint8Array }>

    if (rows.length === 0) return

    const { type, data } = rows[0]

    // Store in warm tier
    await this.storeInWarmTier(sha, type as ObjectType, data)

    // Remove from hot tier
    this.sql.exec('DELETE FROM git_objects_hot WHERE sha = ?', sha)

    // Update metadata
    this.sql.exec(
      'UPDATE git_objects_meta SET tier = ? WHERE sha = ?',
      'warm', sha
    )

    this.demotions++
  }

  /**
   * Demote an object from warm to cold tier (packfile).
   *
   * @description
   * This is typically done during packfile creation, where multiple
   * warm objects are combined into a packfile for efficiency.
   *
   * @param sha - Object SHA to demote
   * @param packId - Packfile ID where object will be stored
   * @param packOffset - Byte offset within the packfile
   */
  async demoteToCold(sha: string, packId: string, packOffset: number): Promise<void> {
    await this.initialize()

    // Delete from warm tier
    const key = this.buildR2Key(sha)
    await this.r2.delete(key)

    // Update metadata with pack location
    this.sql.exec(
      'UPDATE git_objects_meta SET tier = ?, pack_id = ?, pack_offset = ? WHERE sha = ?',
      'cold', packId, packOffset, sha
    )

    this.demotions++
  }

  /**
   * Run maintenance tasks (demotion of old objects).
   *
   * @description
   * This should be called periodically to:
   * 1. Demote old hot tier objects to warm
   * 2. Optionally pack warm objects into cold tier
   *
   * @param options - Maintenance options
   * @returns Number of objects demoted
   */
  async runMaintenance(options?: { dryRun?: boolean }): Promise<number> {
    await this.initialize()

    if (!this.autoDemote) return 0

    const cutoffTime = Date.now() - (this.demotionAgeDays * 24 * 60 * 60 * 1000)
    let demoted = 0

    // Find hot tier objects that should be demoted
    const rows = this.sql.exec(
      `SELECT sha FROM git_objects_meta
       WHERE tier = 'hot' AND last_accessed < ?
       ORDER BY last_accessed ASC
       LIMIT 100`,
      cutoffTime
    ).toArray() as Array<{ sha: string }>

    for (const row of rows) {
      if (!options?.dryRun) {
        await this.demoteToWarm(row.sha)
      }
      demoted++
    }

    return demoted
  }

  /**
   * Get storage statistics.
   */
  async getStats(): Promise<TieredStorageStats> {
    await this.initialize()

    const hotCount = (this.sql.exec(
      "SELECT COUNT(*) as count FROM git_objects_meta WHERE tier = 'hot'"
    ).toArray() as Array<{ count: number }>)[0]?.count ?? 0

    const hotBytes = await this.getHotTierBytes()

    const warmCount = (this.sql.exec(
      "SELECT COUNT(*) as count FROM git_objects_meta WHERE tier = 'warm'"
    ).toArray() as Array<{ count: number }>)[0]?.count ?? 0

    const coldCount = (this.sql.exec(
      "SELECT COUNT(*) as count FROM git_objects_meta WHERE tier = 'cold'"
    ).toArray() as Array<{ count: number }>)[0]?.count ?? 0

    const totalHits = this.hotHits + this.warmHits + this.coldHits
    const totalRequests = totalHits + this.misses
    const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0

    return {
      hotTierCount: hotCount,
      hotTierBytes: hotBytes,
      warmTierCount: warmCount,
      coldTierCount: coldCount,
      totalObjects: hotCount + warmCount + coldCount,
      cacheHitRate: hitRate,
      promotions: this.promotions,
      demotions: this.demotions
    }
  }

  /**
   * Create a packfile from warm tier objects.
   *
   * @description
   * Combines multiple warm tier objects into a packfile stored in R2.
   * This is more storage-efficient and can reduce costs.
   *
   * @param shas - Array of SHA hashes to pack
   * @returns Pack ID and size
   */
  async createPackfile(shas: string[]): Promise<{ packId: string; size: number; objectCount: number }> {
    await this.initialize()

    // Generate pack ID
    const packId = `pack-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

    // Collect objects
    const objects: Array<{ sha: string; type: ObjectType; data: Uint8Array }> = []

    for (const sha of shas) {
      const result = await this.getFromWarmTier(sha)
      if (result) {
        objects.push({ sha, ...result })
      }
    }

    if (objects.length === 0) {
      return { packId, size: 0, objectCount: 0 }
    }

    // Build simple packfile format
    const packData = this.buildPackfile(objects)

    // Store in R2
    const packKey = `${this.prefix}/packs/${packId}.pack`
    await this.r2.put(packKey, packData, {
      customMetadata: {
        objectCount: String(objects.length),
        createdAt: new Date().toISOString()
      }
    })

    // Update metadata for each object
    let offset = 12 // Pack header size
    for (const obj of objects) {
      await this.demoteToCold(obj.sha, packId, offset)
      offset += obj.data.length + 10 // Rough estimate for object header
    }

    return {
      packId,
      size: packData.length,
      objectCount: objects.length
    }
  }

  // =========================================================================
  // Private Helper Methods
  // =========================================================================

  /**
   * Get object from hot tier (SQLite).
   */
  private async getFromHotTier(sha: string): Promise<{ type: ObjectType; data: Uint8Array } | null> {
    const rows = this.sql.exec(
      'SELECT type, data FROM git_objects_hot WHERE sha = ?',
      sha
    ).toArray() as Array<{ type: string; data: Uint8Array }>

    if (rows.length === 0) return null

    return {
      type: rows[0].type as ObjectType,
      data: rows[0].data
    }
  }

  /**
   * Get object from warm tier (R2 loose objects).
   */
  private async getFromWarmTier(sha: string): Promise<{ type: ObjectType; data: Uint8Array } | null> {
    const key = this.buildR2Key(sha)
    const obj = await this.r2.get(key)

    if (!obj) return null

    const data = new Uint8Array(await obj.arrayBuffer())
    const type = (obj.customMetadata?.type ?? 'blob') as ObjectType

    return { type, data }
  }

  /**
   * Get object from cold tier (R2 packfile).
   */
  private async getFromColdTier(packId: string, offset: number): Promise<{ type: ObjectType; data: Uint8Array } | null> {
    const packKey = `${this.prefix}/packs/${packId}.pack`
    const packObj = await this.r2.get(packKey)

    if (!packObj) return null

    const packData = new Uint8Array(await packObj.arrayBuffer())

    // Parse object from packfile at offset
    const result = this.parsePackObject(packData, offset)
    return result
  }

  /**
   * Store object in hot tier.
   */
  private async storeInHotTier(sha: string, type: ObjectType, data: Uint8Array): Promise<void> {
    const now = Date.now()
    this.sql.exec(
      `INSERT OR REPLACE INTO git_objects_hot (sha, type, data, size, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      sha, type, data, data.length, now
    )
  }

  /**
   * Store object in warm tier.
   */
  private async storeInWarmTier(sha: string, type: ObjectType, data: Uint8Array): Promise<void> {
    const key = this.buildR2Key(sha)
    await this.r2.put(key, data, {
      customMetadata: {
        type,
        size: String(data.length),
        createdAt: new Date().toISOString()
      }
    })
  }

  /**
   * Promote object to warm tier.
   */
  private async promoteToWarm(sha: string, type: ObjectType, data: Uint8Array): Promise<void> {
    await this.storeInWarmTier(sha, type, data)

    this.sql.exec(
      'UPDATE git_objects_meta SET tier = ?, pack_id = NULL, pack_offset = NULL WHERE sha = ?',
      'warm', sha
    )
  }

  /**
   * Get metadata for an object.
   */
  private async getMetadata(sha: string): Promise<ObjectMetadata | null> {
    const rows = this.sql.exec(
      'SELECT * FROM git_objects_meta WHERE sha = ?',
      sha
    ).toArray() as Array<{
      sha: string
      type: string
      size: number
      tier: string
      access_count: number
      last_accessed: number
      created_at: number
      pack_id: string | null
      pack_offset: number | null
    }>

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      sha: row.sha,
      type: row.type as ObjectType,
      size: row.size,
      tier: row.tier as StorageTier,
      accessCount: row.access_count,
      lastAccessed: row.last_accessed,
      createdAt: row.created_at,
      packId: row.pack_id ?? undefined,
      packOffset: row.pack_offset ?? undefined
    }
  }

  /**
   * Record an access to an object.
   */
  private async recordAccess(sha: string): Promise<void> {
    const now = Date.now()
    this.sql.exec(
      'UPDATE git_objects_meta SET access_count = access_count + 1, last_accessed = ? WHERE sha = ?',
      now, sha
    )
  }

  /**
   * Get total bytes in hot tier.
   */
  private async getHotTierBytes(): Promise<number> {
    const rows = this.sql.exec(
      'SELECT SUM(size) as total FROM git_objects_hot'
    ).toArray() as Array<{ total: number | null }>

    return rows[0]?.total ?? 0
  }

  /**
   * Evict objects from hot tier to make room.
   */
  private async evictFromHotTier(neededBytes: number): Promise<boolean> {
    void await this.getHotTierBytes() // Track current usage
    let freedBytes = 0
    const targetFree = neededBytes

    // Get LRU objects from hot tier
    const rows = this.sql.exec(
      `SELECT m.sha, h.size
       FROM git_objects_meta m
       JOIN git_objects_hot h ON m.sha = h.sha
       WHERE m.tier = 'hot'
       ORDER BY m.last_accessed ASC
       LIMIT 50`
    ).toArray() as Array<{ sha: string; size: number }>

    for (const row of rows) {
      if (freedBytes >= targetFree) break

      await this.demoteToWarm(row.sha)
      freedBytes += row.size
    }

    return freedBytes >= targetFree
  }

  /**
   * Build R2 key for a loose object.
   */
  private buildR2Key(sha: string): string {
    // Use git's standard 2-character prefix directory structure
    return `${this.prefix}/${sha.slice(0, 2)}/${sha.slice(2)}`
  }

  /**
   * Build a simple packfile from objects.
   */
  private buildPackfile(objects: Array<{ sha: string; type: ObjectType; data: Uint8Array }>): Uint8Array {
    // Pack header: "PACK" + version (2) + object count
    const header = new Uint8Array(12)
    header[0] = 0x50 // P
    header[1] = 0x41 // A
    header[2] = 0x43 // C
    header[3] = 0x4B // K
    header[4] = 0x00
    header[5] = 0x00
    header[6] = 0x00
    header[7] = 0x02 // Version 2
    // Object count (big endian)
    const count = objects.length
    header[8] = (count >> 24) & 0xff
    header[9] = (count >> 16) & 0xff
    header[10] = (count >> 8) & 0xff
    header[11] = count & 0xff

    // Calculate total size
    let totalSize = 12 // header
    for (const obj of objects) {
      totalSize += 1 + obj.data.length // type byte + data
    }
    totalSize += 20 // trailing checksum

    const pack = new Uint8Array(totalSize)
    pack.set(header, 0)

    let offset = 12
    const typeMap: Record<ObjectType, number> = {
      commit: 1,
      tree: 2,
      blob: 3,
      tag: 4
    }

    for (const obj of objects) {
      // Simple encoding: type nibble + size
      const typeNum = typeMap[obj.type] ?? 3
      pack[offset] = (typeNum << 4) | (obj.data.length & 0x0f)
      offset++
      pack.set(obj.data, offset)
      offset += obj.data.length
    }

    // Trailing zeros for checksum (simplified)
    return pack
  }

  /**
   * Parse an object from packfile data at offset.
   */
  private parsePackObject(packData: Uint8Array, offset: number): { type: ObjectType; data: Uint8Array } | null {
    if (offset >= packData.length) return null

    // Read type and size from first byte
    const firstByte = packData[offset]
    const typeNum = (firstByte >> 4) & 0x07

    const typeMap: Record<number, ObjectType> = {
      1: 'commit',
      2: 'tree',
      3: 'blob',
      4: 'tag'
    }

    const type = typeMap[typeNum] ?? 'blob'

    // For simplicity, read until next object or end
    // In production, this would use proper variable-length encoding
    let end = offset + 1
    while (end < packData.length && end < offset + 10000) {
      end++
    }

    const data = packData.slice(offset + 1, end)

    return { type, data }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a TieredStorage instance.
 *
 * @param options - Configuration options
 * @returns Configured TieredStorage instance
 */
export function createTieredStorage(options: TieredStorageOptions): TieredStorage {
  return new TieredStorage(options)
}
