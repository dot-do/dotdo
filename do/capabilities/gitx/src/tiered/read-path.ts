/**
 * @fileoverview Tiered Read Path Module
 *
 * @description
 * Implements reading objects from a multi-tier storage system designed for
 * Git object storage. The tiered approach optimizes for both performance and
 * cost by organizing data across multiple storage layers with different
 * characteristics:
 *
 * **Storage Tiers:**
 * - **Hot tier**: Durable Object SQLite (fastest, local, highest cost)
 * - **Warm tier**: R2 object storage (medium latency, packed objects)
 * - **Cold tier**: Analytics/Parquet (highest latency, lowest cost)
 *
 * **Features:**
 * - Automatic tier fallback on cache miss
 * - Read-through caching with promotion to hotter tiers
 * - Configurable promotion policies (aggressive, conservative, none)
 * - Latency tracking for performance monitoring
 *
 * **Architecture:**
 * The TieredReader orchestrates reads across all tiers, attempting to serve
 * data from the fastest available tier while optionally promoting frequently
 * accessed objects to faster tiers.
 *
 * @example
 * ```typescript
 * // Create a tiered reader with all backends
 * const reader = new TieredReader(
 *   hotBackend,
 *   warmBackend,
 *   coldBackend,
 *   {
 *     hot: { enabled: true, maxSize: 1024 * 1024 },
 *     warm: { enabled: true },
 *     cold: { enabled: true },
 *     promotionPolicy: 'aggressive'
 *   }
 * )
 *
 * // Read an object - will try hot -> warm -> cold
 * const result = await reader.read('abc123...')
 * if (result.object) {
 *   console.log(`Found in ${result.tier} tier`)
 *   console.log(`Latency: ${result.latencyMs}ms`)
 *   if (result.promoted) {
 *     console.log('Object was promoted to hot tier')
 *   }
 * }
 * ```
 *
 * @module tiered/read-path
 * @see {@link TieredReader} - Main implementation class
 * @see {@link TieredStorageConfig} - Configuration options
 */

import { ObjectType } from '../types/objects'

/**
 * Represents a Git object stored in the tiered storage system.
 *
 * @description
 * StoredObject is the common representation of a Git object across all storage
 * tiers. It contains the object's content, metadata, and timing information
 * needed for cache management and analytics.
 *
 * @example
 * ```typescript
 * const blobObject: StoredObject = {
 *   sha: 'a1b2c3d4e5f6...',
 *   type: 'blob',
 *   size: 1024,
 *   data: new Uint8Array([...]),
 *   createdAt: Date.now()
 * }
 * ```
 *
 * @interface StoredObject
 */
export interface StoredObject {
  /**
   * SHA-1 hash of the object content.
   * Must be a 40-character hexadecimal string.
   *
   * @example 'a1b2c3d4e5f678901234567890abcdef12345678'
   */
  sha: string

  /**
   * Git object type (blob, tree, commit, or tag).
   *
   * @see {@link ObjectType}
   */
  type: ObjectType

  /**
   * Size of the uncompressed object data in bytes.
   */
  size: number

  /**
   * Raw object data as a byte array.
   * This is the uncompressed content of the Git object.
   */
  data: Uint8Array

  /**
   * Unix timestamp (milliseconds) when the object was first stored.
   * Used for TTL calculations and analytics.
   */
  createdAt: number
}

/**
 * Configuration options for a single storage tier.
 *
 * @description
 * Each tier can be individually enabled/disabled and configured with
 * size limits and TTL (time-to-live) settings. This allows fine-grained
 * control over which objects are stored in each tier.
 *
 * @example
 * ```typescript
 * // Hot tier with size limit and TTL
 * const hotConfig: TierConfig = {
 *   enabled: true,
 *   maxSize: 1024 * 1024, // 1MB max object size
 *   ttl: 3600 * 1000      // 1 hour TTL
 * }
 *
 * // Disabled tier
 * const disabledConfig: TierConfig = {
 *   enabled: false
 * }
 * ```
 *
 * @interface TierConfig
 */
export interface TierConfig {
  /**
   * Whether this tier is enabled for reads and writes.
   * Disabled tiers are skipped during read operations.
   */
  enabled: boolean

  /**
   * Maximum object size in bytes that can be stored in this tier.
   * Objects larger than this size will not be promoted to this tier.
   * If undefined, no size limit is enforced.
   *
   * @example 1048576 // 1MB
   */
  maxSize?: number

  /**
   * Time-to-live in milliseconds for objects in this tier.
   * Objects older than TTL may be evicted or migrated to colder tiers.
   * If undefined, objects persist indefinitely.
   *
   * @example 3600000 // 1 hour
   */
  ttl?: number
}

/**
 * Complete configuration for the tiered storage system.
 *
 * @description
 * Defines the behavior of all three storage tiers (hot, warm, cold) and
 * the promotion policy that determines when objects are moved to faster tiers.
 *
 * **Promotion Policies:**
 * - `aggressive`: Immediately promote objects to hot tier on first access
 * - `conservative`: Only promote on repeated access (not yet implemented)
 * - `none`: Never automatically promote objects
 *
 * @example
 * ```typescript
 * const config: TieredStorageConfig = {
 *   hot: {
 *     enabled: true,
 *     maxSize: 1024 * 1024,  // 1MB max
 *     ttl: 3600 * 1000       // 1 hour
 *   },
 *   warm: {
 *     enabled: true,
 *     maxSize: 10 * 1024 * 1024  // 10MB max
 *   },
 *   cold: {
 *     enabled: true
 *     // No size limit for cold storage
 *   },
 *   promotionPolicy: 'aggressive'
 * }
 * ```
 *
 * @interface TieredStorageConfig
 */
export interface TieredStorageConfig {
  /**
   * Configuration for the hot tier (Durable Object SQLite).
   * Hot tier provides the fastest access but has limited capacity.
   */
  hot: TierConfig

  /**
   * Configuration for the warm tier (R2 object storage).
   * Warm tier provides moderate latency with larger capacity.
   */
  warm: TierConfig

  /**
   * Configuration for the cold tier (Analytics/Parquet).
   * Cold tier provides lowest cost storage for archival.
   */
  cold: TierConfig

  /**
   * Policy for promoting objects to hotter tiers.
   *
   * - `aggressive`: Promote on first read from colder tier
   * - `conservative`: Promote only on repeated access
   * - `none`: Never automatically promote
   */
  promotionPolicy: 'aggressive' | 'conservative' | 'none'
}

/**
 * Result of a read operation from the tiered storage system.
 *
 * @description
 * ReadResult provides complete information about a read operation, including
 * the retrieved object (if found), which tier served the request, whether
 * the object was promoted, and latency metrics.
 *
 * @example
 * ```typescript
 * const result = await reader.read(sha)
 *
 * if (result.object) {
 *   console.log(`Object found in ${result.tier} tier`)
 *   console.log(`Size: ${result.object.size} bytes`)
 *   console.log(`Latency: ${result.latencyMs}ms`)
 *
 *   if (result.promoted) {
 *     console.log('Object was promoted to hot tier for faster future access')
 *   }
 * } else {
 *   console.log('Object not found in any tier')
 *   console.log(`Search took ${result.latencyMs}ms`)
 * }
 * ```
 *
 * @interface ReadResult
 */
export interface ReadResult {
  /**
   * The retrieved object, or null if not found in any tier.
   */
  object: StoredObject | null

  /**
   * The tier that served the request, or null if object was not found.
   */
  tier: 'hot' | 'warm' | 'cold' | null

  /**
   * Whether the object was promoted to a hotter tier during this read.
   * Only true if the object was found in warm/cold tier and successfully
   * copied to the hot tier.
   */
  promoted: boolean

  /**
   * Total latency of the read operation in milliseconds.
   * Includes time spent checking all tiers and any promotion overhead.
   */
  latencyMs: number
}

/**
 * Interface for the tiered object store.
 *
 * @description
 * Defines the public API for interacting with the tiered storage system.
 * Implementations must provide methods for reading from any tier,
 * manual promotion, and configuration access.
 *
 * @example
 * ```typescript
 * class MyTieredStore implements TieredObjectStore {
 *   async read(sha: string): Promise<ReadResult> {
 *     // Implementation
 *   }
 *   // ... other methods
 * }
 * ```
 *
 * @interface TieredObjectStore
 */
export interface TieredObjectStore {
  /**
   * Reads an object from the tiered storage system.
   *
   * @description
   * Attempts to read the object from each enabled tier in order
   * (hot -> warm -> cold), returning as soon as the object is found.
   * May promote the object to the hot tier based on the promotion policy.
   *
   * @param sha - The 40-character SHA-1 hash of the object to read
   * @returns Promise resolving to the read result
   *
   * @example
   * ```typescript
   * const result = await store.read('abc123...')
   * if (result.object) {
   *   // Process the object data
   * }
   * ```
   */
  read(sha: string): Promise<ReadResult>

  /**
   * Reads an object directly from the hot tier only.
   *
   * @description
   * Bypasses the tier fallback logic to read directly from the hot tier.
   * Useful for checking if an object is already cached.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to the object or null if not in hot tier
   */
  readFromHot(sha: string): Promise<StoredObject | null>

  /**
   * Reads an object directly from the warm tier only.
   *
   * @description
   * Bypasses the tier fallback logic to read directly from the warm tier.
   * Does not trigger promotion to the hot tier.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to the object or null if not in warm tier
   */
  readFromWarm(sha: string): Promise<StoredObject | null>

  /**
   * Reads an object directly from the cold tier only.
   *
   * @description
   * Bypasses the tier fallback logic to read directly from the cold tier.
   * Does not trigger promotion to hotter tiers.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to the object or null if not in cold tier
   */
  readFromCold(sha: string): Promise<StoredObject | null>

  /**
   * Manually promotes an object to the hot tier.
   *
   * @description
   * Copies the provided object to the hot tier storage. This is useful for
   * pre-warming the cache or manually controlling tier placement.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @param object - The complete stored object to promote
   * @returns Promise that resolves when promotion is complete
   *
   * @example
   * ```typescript
   * // Pre-warm the cache with frequently accessed objects
   * for (const obj of frequentObjects) {
   *   await store.promoteToHot(obj.sha, obj)
   * }
   * ```
   */
  promoteToHot(sha: string, object: StoredObject): Promise<void>

  /**
   * Returns the current storage configuration.
   *
   * @returns The tiered storage configuration
   */
  getConfig(): TieredStorageConfig
}

/**
 * Backend interface for the hot tier (Durable Object SQLite).
 *
 * @description
 * The hot tier backend provides fast, local storage using Durable Object
 * SQLite. It supports full CRUD operations for Git objects.
 *
 * @example
 * ```typescript
 * class SqliteHotBackend implements HotTierBackend {
 *   async get(sha: string): Promise<StoredObject | null> {
 *     const row = await this.db.get('SELECT * FROM objects WHERE sha = ?', sha)
 *     return row ? this.rowToObject(row) : null
 *   }
 *
 *   async put(sha: string, object: StoredObject): Promise<void> {
 *     await this.db.run(
 *       'INSERT OR REPLACE INTO objects VALUES (?, ?, ?, ?, ?)',
 *       sha, object.type, object.size, object.data, object.createdAt
 *     )
 *   }
 *
 *   async delete(sha: string): Promise<boolean> {
 *     const result = await this.db.run('DELETE FROM objects WHERE sha = ?', sha)
 *     return result.changes > 0
 *   }
 *
 *   async has(sha: string): Promise<boolean> {
 *     const row = await this.db.get('SELECT 1 FROM objects WHERE sha = ?', sha)
 *     return !!row
 *   }
 * }
 * ```
 *
 * @interface HotTierBackend
 */
export interface HotTierBackend {
  /**
   * Retrieves an object from the hot tier.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to the object or null if not found
   */
  get(sha: string): Promise<StoredObject | null>

  /**
   * Stores an object in the hot tier.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @param object - The complete stored object to write
   * @returns Promise that resolves when the write is complete
   */
  put(sha: string, object: StoredObject): Promise<void>

  /**
   * Deletes an object from the hot tier.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to true if object was deleted, false if not found
   */
  delete(sha: string): Promise<boolean>

  /**
   * Checks if an object exists in the hot tier.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to true if object exists
   */
  has(sha: string): Promise<boolean>
}

/**
 * Backend interface for the warm tier (R2 object storage).
 *
 * @description
 * The warm tier backend provides access to objects stored in R2, either
 * as individual objects or within packfiles. Packfile access allows
 * efficient retrieval of objects that have been packed together.
 *
 * @example
 * ```typescript
 * class R2WarmBackend implements WarmTierBackend {
 *   async get(sha: string): Promise<StoredObject | null> {
 *     // Try direct object first
 *     const obj = await this.r2.get(`objects/${sha}`)
 *     if (obj) return this.parseObject(obj)
 *
 *     // Fall back to pack lookup
 *     const location = await this.index.findInPack(sha)
 *     if (location) {
 *       return this.getFromPack(location.packId, location.offset)
 *     }
 *     return null
 *   }
 *
 *   async getFromPack(packId: string, offset: number): Promise<StoredObject | null> {
 *     const pack = await this.r2.get(`packs/${packId}`)
 *     return pack ? this.extractFromPack(pack, offset) : null
 *   }
 * }
 * ```
 *
 * @interface WarmTierBackend
 */
export interface WarmTierBackend {
  /**
   * Retrieves an object from the warm tier.
   *
   * @description
   * May retrieve the object either directly or from a packfile,
   * depending on how it was stored.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to the object or null if not found
   */
  get(sha: string): Promise<StoredObject | null>

  /**
   * Retrieves an object from a specific packfile at a given offset.
   *
   * @description
   * Used when the exact location of an object within a packfile is known,
   * typically from an index lookup.
   *
   * @param packId - The identifier of the packfile
   * @param offset - Byte offset of the object within the pack
   * @returns Promise resolving to the object or null if not found
   */
  getFromPack(packId: string, offset: number): Promise<StoredObject | null>
}

/**
 * Backend interface for the cold tier (Analytics/Parquet).
 *
 * @description
 * The cold tier backend provides access to objects stored in analytical
 * formats like Parquet. It supports both direct lookups and filtered
 * queries for analytics purposes.
 *
 * @example
 * ```typescript
 * class ParquetColdBackend implements ColdTierBackend {
 *   async get(sha: string): Promise<StoredObject | null> {
 *     const rows = await this.parquet.query(`
 *       SELECT * FROM objects WHERE sha = '${sha}'
 *     `)
 *     return rows[0] ? this.rowToObject(rows[0]) : null
 *   }
 *
 *   async query(filter: { type?: ObjectType }): Promise<StoredObject[]> {
 *     const conditions = []
 *     if (filter.type) conditions.push(`type = '${filter.type}'`)
 *     if (filter.minSize) conditions.push(`size >= ${filter.minSize}`)
 *
 *     const sql = `SELECT * FROM objects WHERE ${conditions.join(' AND ')}`
 *     const rows = await this.parquet.query(sql)
 *     return rows.map(this.rowToObject)
 *   }
 * }
 * ```
 *
 * @interface ColdTierBackend
 */
export interface ColdTierBackend {
  /**
   * Retrieves an object from the cold tier by SHA.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to the object or null if not found
   */
  get(sha: string): Promise<StoredObject | null>

  /**
   * Queries the cold tier for objects matching the given filter.
   *
   * @description
   * Performs a filtered query against the analytical storage, returning
   * all objects that match the specified criteria. Useful for analytics
   * and batch processing operations.
   *
   * @param filter - Filter criteria for the query
   * @param filter.type - Filter by Git object type
   * @param filter.minSize - Minimum object size in bytes
   * @param filter.maxSize - Maximum object size in bytes
   * @returns Promise resolving to array of matching objects
   *
   * @example
   * ```typescript
   * // Find all large blobs
   * const largeBlobs = await coldBackend.query({
   *   type: 'blob',
   *   minSize: 1024 * 1024  // > 1MB
   * })
   * ```
   */
  query(filter: { type?: ObjectType; minSize?: number; maxSize?: number }): Promise<StoredObject[]>
}

/**
 * Validates a SHA-1 hash string.
 *
 * @description
 * Checks that the provided string is a valid 40-character hexadecimal
 * SHA-1 hash. Used internally to validate input before querying storage.
 *
 * @param sha - The string to validate
 * @returns true if the string is a valid SHA-1 hash, false otherwise
 *
 * @example
 * ```typescript
 * isValidSha('abc123')  // false - too short
 * isValidSha('a1b2c3d4e5f678901234567890abcdef12345678')  // true
 * isValidSha('xyz123...')  // false - invalid characters
 * ```
 *
 * @internal
 */
function isValidSha(sha: string): boolean {
  if (!sha || sha.length !== 40) {
    return false
  }
  return /^[0-9a-f]{40}$/i.test(sha)
}

/**
 * TieredReader - Main implementation of the tiered read path.
 *
 * @description
 * TieredReader orchestrates reads across multiple storage tiers (hot, warm, cold),
 * implementing automatic fallback and optional promotion to hotter tiers. It provides
 * a unified interface for reading Git objects regardless of which tier they reside in.
 *
 * **Read Algorithm:**
 * 1. Validate the SHA-1 hash
 * 2. If hot tier enabled, attempt to read from hot tier
 * 3. If not found and warm tier enabled, attempt warm tier
 * 4. If not found and cold tier enabled, attempt cold tier
 * 5. If found in warm/cold, optionally promote to hot tier
 * 6. Return result with object, source tier, and metrics
 *
 * **Promotion Policies:**
 * - `aggressive`: Immediately promote any object read from warm/cold to hot
 * - `conservative`: Reserved for future implementation (repeated access tracking)
 * - `none`: Never automatically promote objects
 *
 * **Error Handling:**
 * Individual tier failures are silently caught and the next tier is tried.
 * This ensures graceful degradation when a tier is temporarily unavailable.
 *
 * @example
 * ```typescript
 * // Create backends for each tier
 * const hotBackend = new SqliteHotBackend(db)
 * const warmBackend = new R2WarmBackend(r2)
 * const coldBackend = new ParquetColdBackend(parquet)
 *
 * // Configure the tiered storage
 * const config: TieredStorageConfig = {
 *   hot: { enabled: true, maxSize: 1024 * 1024 },
 *   warm: { enabled: true },
 *   cold: { enabled: true },
 *   promotionPolicy: 'aggressive'
 * }
 *
 * // Create the reader
 * const reader = new TieredReader(hotBackend, warmBackend, coldBackend, config)
 *
 * // Read an object
 * const result = await reader.read('a1b2c3d4e5f678901234567890abcdef12345678')
 *
 * if (result.object) {
 *   console.log(`Object type: ${result.object.type}`)
 *   console.log(`Size: ${result.object.size} bytes`)
 *   console.log(`Served from: ${result.tier} tier`)
 *   console.log(`Latency: ${result.latencyMs}ms`)
 *
 *   if (result.promoted) {
 *     console.log('Object was promoted to hot tier')
 *   }
 * } else {
 *   console.log('Object not found in any tier')
 * }
 *
 * // Direct tier access
 * const hotOnly = await reader.readFromHot(sha)
 * const warmOnly = await reader.readFromWarm(sha)
 * const coldOnly = await reader.readFromCold(sha)
 *
 * // Manual promotion
 * if (warmOnly) {
 *   await reader.promoteToHot(sha, warmOnly)
 * }
 * ```
 *
 * @class TieredReader
 * @implements {TieredObjectStore}
 */
export class TieredReader implements TieredObjectStore {
  /**
   * Backend for the hot storage tier (Durable Object SQLite).
   * @private
   */
  private hotBackend: HotTierBackend

  /**
   * Backend for the warm storage tier (R2 object storage).
   * @private
   */
  private warmBackend: WarmTierBackend

  /**
   * Backend for the cold storage tier (Analytics/Parquet).
   * @private
   */
  private coldBackend: ColdTierBackend

  /**
   * Configuration for all tiers and promotion policy.
   * @private
   */
  private config: TieredStorageConfig

  /**
   * Creates a new TieredReader instance.
   *
   * @param hotBackend - Backend for the hot tier (Durable Object SQLite)
   * @param warmBackend - Backend for the warm tier (R2)
   * @param coldBackend - Backend for the cold tier (Parquet)
   * @param config - Configuration for all tiers and promotion policy
   *
   * @example
   * ```typescript
   * const reader = new TieredReader(
   *   hotBackend,
   *   warmBackend,
   *   coldBackend,
   *   {
   *     hot: { enabled: true, maxSize: 1024 * 1024 },
   *     warm: { enabled: true },
   *     cold: { enabled: true },
   *     promotionPolicy: 'aggressive'
   *   }
   * )
   * ```
   */
  constructor(
    hotBackend: HotTierBackend,
    warmBackend: WarmTierBackend,
    coldBackend: ColdTierBackend,
    config: TieredStorageConfig
  ) {
    this.hotBackend = hotBackend
    this.warmBackend = warmBackend
    this.coldBackend = coldBackend
    this.config = config
  }

  /**
   * Reads an object from the tiered storage system.
   *
   * @description
   * Attempts to read the object from each enabled tier in order
   * (hot -> warm -> cold), returning as soon as the object is found.
   * Objects found in warm or cold tiers may be promoted to hot tier
   * based on the configured promotion policy.
   *
   * **Invalid SHA Handling:**
   * If the SHA is invalid (not 40 hex characters), returns immediately
   * with null object and no tier lookup is performed.
   *
   * **Error Handling:**
   * If a tier fails (throws an error), the error is caught silently
   * and the next tier is attempted. This provides graceful degradation.
   *
   * @param sha - The 40-character SHA-1 hash of the object to read
   * @returns Promise resolving to the read result with object, tier, and metrics
   *
   * @example
   * ```typescript
   * const result = await reader.read('a1b2c3d4e5f678901234567890abcdef12345678')
   *
   * if (result.object) {
   *   // Object found
   *   console.log(`Type: ${result.object.type}`)
   *   console.log(`Tier: ${result.tier}`)
   *   console.log(`Promoted: ${result.promoted}`)
   * } else {
   *   // Object not found
   *   console.log(`Search took ${result.latencyMs}ms`)
   * }
   * ```
   */
  async read(sha: string): Promise<ReadResult> {
    const startTime = performance.now()

    // Validate SHA
    if (!isValidSha(sha)) {
      return {
        object: null,
        tier: null,
        promoted: false,
        latencyMs: performance.now() - startTime
      }
    }

    // Try hot tier first
    if (this.config.hot.enabled) {
      try {
        const obj = await this.hotBackend.get(sha)
        if (obj) {
          return {
            object: obj,
            tier: 'hot',
            promoted: false,
            latencyMs: performance.now() - startTime
          }
        }
      } catch {
        // Hot tier failed, continue to next tier
      }
    }

    // Try warm tier
    if (this.config.warm.enabled) {
      try {
        const obj = await this.warmBackend.get(sha)
        if (obj) {
          const promoted = await this.tryPromote(sha, obj, 'warm')
          return {
            object: obj,
            tier: 'warm',
            promoted,
            latencyMs: performance.now() - startTime
          }
        }
      } catch {
        // Warm tier failed, continue to cold tier
      }
    }

    // Try cold tier
    if (this.config.cold.enabled) {
      try {
        const obj = await this.coldBackend.get(sha)
        if (obj) {
          const promoted = await this.tryPromote(sha, obj, 'cold')
          return {
            object: obj,
            tier: 'cold',
            promoted,
            latencyMs: performance.now() - startTime
          }
        }
      } catch {
        // Cold tier failed
      }
    }

    // Object not found in any tier
    return {
      object: null,
      tier: null,
      promoted: false,
      latencyMs: performance.now() - startTime
    }
  }

  /**
   * Reads an object directly from the hot tier only.
   *
   * @description
   * Bypasses the tier fallback logic to read directly from the hot tier.
   * Useful for checking if an object is already in the hot cache.
   * Errors are caught and null is returned.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to the object or null if not in hot tier
   *
   * @example
   * ```typescript
   * const cached = await reader.readFromHot(sha)
   * if (cached) {
   *   console.log('Object is in hot cache')
   * } else {
   *   console.log('Object not in hot cache')
   * }
   * ```
   */
  async readFromHot(sha: string): Promise<StoredObject | null> {
    try {
      return await this.hotBackend.get(sha)
    } catch {
      return null
    }
  }

  /**
   * Reads an object directly from the warm tier only.
   *
   * @description
   * Bypasses the tier fallback logic to read directly from the warm tier.
   * Does not trigger automatic promotion to hot tier.
   * Errors are caught and null is returned.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to the object or null if not in warm tier
   *
   * @example
   * ```typescript
   * const warm = await reader.readFromWarm(sha)
   * if (warm) {
   *   // Manually promote if desired
   *   await reader.promoteToHot(sha, warm)
   * }
   * ```
   */
  async readFromWarm(sha: string): Promise<StoredObject | null> {
    try {
      return await this.warmBackend.get(sha)
    } catch {
      return null
    }
  }

  /**
   * Reads an object directly from the cold tier only.
   *
   * @description
   * Bypasses the tier fallback logic to read directly from the cold tier.
   * Does not trigger automatic promotion to hotter tiers.
   * Errors are caught and null is returned.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @returns Promise resolving to the object or null if not in cold tier
   *
   * @example
   * ```typescript
   * const cold = await reader.readFromCold(sha)
   * if (cold) {
   *   console.log(`Found in cold storage, created at: ${cold.createdAt}`)
   * }
   * ```
   */
  async readFromCold(sha: string): Promise<StoredObject | null> {
    try {
      return await this.coldBackend.get(sha)
    } catch {
      return null
    }
  }

  /**
   * Manually promotes an object to the hot tier.
   *
   * @description
   * Copies the provided object to the hot tier storage. This is useful for
   * pre-warming the cache or manually controlling tier placement. No size
   * or policy checks are performed - the object is always written.
   *
   * @param sha - The 40-character SHA-1 hash of the object
   * @param object - The complete stored object to promote
   * @returns Promise that resolves when promotion is complete
   * @throws Error if the hot tier write fails
   *
   * @example
   * ```typescript
   * // Pre-warm the hot cache
   * const objects = await reader.query({ type: 'commit' })
   * for (const obj of objects) {
   *   await reader.promoteToHot(obj.sha, obj)
   * }
   * ```
   */
  async promoteToHot(sha: string, object: StoredObject): Promise<void> {
    await this.hotBackend.put(sha, object)
  }

  /**
   * Returns the current storage configuration.
   *
   * @description
   * Returns the configuration object passed to the constructor.
   * Useful for inspecting current settings or debugging.
   *
   * @returns The tiered storage configuration
   *
   * @example
   * ```typescript
   * const config = reader.getConfig()
   * console.log(`Promotion policy: ${config.promotionPolicy}`)
   * console.log(`Hot tier enabled: ${config.hot.enabled}`)
   * ```
   */
  getConfig(): TieredStorageConfig {
    return this.config
  }

  /**
   * Attempts to promote an object to the hot tier based on policy.
   *
   * @description
   * Called internally when an object is found in warm or cold tier.
   * Decides whether to promote based on:
   * 1. Hot tier being enabled
   * 2. Promotion policy (aggressive promotes, conservative/none don't)
   * 3. Object size being within hot tier's maxSize limit
   *
   * @param sha - The object's SHA-1 hash
   * @param object - The object to potentially promote
   * @param _sourceTier - The tier the object was read from (for future use)
   * @returns true if promotion was successful, false otherwise
   *
   * @private
   */
  private async tryPromote(
    sha: string,
    object: StoredObject,
    _sourceTier: 'warm' | 'cold'
  ): Promise<boolean> {
    // Check if hot tier is enabled
    if (!this.config.hot.enabled) {
      return false
    }

    // Check promotion policy
    if (this.config.promotionPolicy === 'none') {
      return false
    }

    // Conservative policy only promotes from warm tier on repeated access
    // For now, conservative means no automatic promotion on first read
    if (this.config.promotionPolicy === 'conservative') {
      return false
    }

    // Check size limit for hot tier
    if (this.config.hot.maxSize !== undefined && object.size > this.config.hot.maxSize) {
      return false
    }

    // Try to promote
    try {
      await this.hotBackend.put(sha, object)
      return true
    } catch {
      // Promotion failed, but we still have the object
      return false
    }
  }
}

// Re-export as TieredObjectStoreStub for backward compatibility with tests
export { TieredReader as TieredObjectStoreStub }
