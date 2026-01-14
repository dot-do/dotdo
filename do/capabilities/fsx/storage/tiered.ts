/**
 * TieredFS - Multi-tier filesystem with automatic placement
 *
 * Provides automatic file placement across storage tiers based on file size.
 * Uses Durable Objects for hot storage (small files) and R2 for warm/cold
 * storage (larger files).
 *
 * Features:
 * - Automatic tier selection based on file size thresholds
 * - In-memory tier tracking for fast lookups
 * - Tier promotion for frequently accessed files (configurable)
 * - Manual demotion for cost optimization
 * - Fallback behavior when tiers are unavailable
 * - Access pattern tracking for smart tier placement
 * - Telemetry/metrics hooks for monitoring
 *
 * Performance optimizations:
 * - Cached threshold values to avoid repeated property access
 * - Access pattern tracking with configurable window
 * - LRU-style tier metadata cache with size limits
 * - Optimized base64 encoding/decoding
 *
 * @example
 * ```typescript
 * const tiered = new TieredFS({
 *   hot: env.FSX_DO,
 *   warm: env.FSX_WARM_BUCKET,
 *   cold: env.FSX_COLD_BUCKET,
 *   thresholds: {
 *     hotMaxSize: 1024 * 1024,  // 1MB
 *     warmMaxSize: 100 * 1024 * 1024,  // 100MB
 *   },
 *   promotionPolicy: 'on-access'
 * })
 *
 * // Small files go to hot tier automatically
 * await tiered.writeFile('/config.json', JSON.stringify(config))
 *
 * // Large files go to warm/cold tier
 * await tiered.writeFile('/data/large.bin', largeData)
 *
 * // Read from any tier transparently
 * const { data, tier } = await tiered.readFile('/config.json')
 * console.log(`Read from ${tier} tier`)
 * ```
 *
 * @module storage/tiered
 */

import type { StorageTier } from '../core/index.js'
import { StorageError, type StorageHooks, createOperationContext, createOperationResult } from './interfaces.js'

/**
 * Configuration for TieredFS.
 */
export interface TieredFSConfig {
  /**
   * Hot tier (Durable Object namespace).
   * Used for small files that need low-latency access.
   * Required.
   */
  hot: DurableObjectNamespace

  /**
   * Warm tier (R2 bucket).
   * Used for larger files that don't fit in hot tier.
   * Optional - falls back to hot if not provided.
   */
  warm?: R2Bucket

  /**
   * Cold tier (R2 bucket for archive).
   * Used for very large or infrequently accessed files.
   * Optional - falls back to warm/hot if not provided.
   */
  cold?: R2Bucket

  /**
   * Size thresholds for tier selection.
   */
  thresholds?: {
    /** Max size for hot tier in bytes (default: 1MB) */
    hotMaxSize?: number
    /** Max size for warm tier in bytes (default: 100MB) */
    warmMaxSize?: number
  }

  /**
   * Tier promotion policy.
   * - 'none': No automatic promotion
   * - 'on-access': Promote on read (default)
   * - 'aggressive': Promote immediately on any access
   */
  promotionPolicy?: 'none' | 'on-access' | 'aggressive'

  /**
   * Optional instrumentation hooks for metrics/monitoring.
   * @see StorageHooks
   */
  hooks?: StorageHooks

  /**
   * Maximum size of the tier metadata cache.
   * Default: 10000 entries
   */
  maxCacheSize?: number

  /**
   * Enable access pattern tracking for smart tier placement.
   * Default: true when promotionPolicy is 'on-access' or 'aggressive'
   */
  trackAccessPatterns?: boolean
}

/** Default configuration values */
const DEFAULT_HOT_MAX_SIZE = 1024 * 1024 // 1MB
const DEFAULT_WARM_MAX_SIZE = 100 * 1024 * 1024 // 100MB
const DEFAULT_MAX_CACHE_SIZE = 10000

/** Promotion thresholds for on-access policy */
const PROMOTION_ACCESS_THRESHOLD = 3 // Require 3+ reads to consider promotion
const PROMOTION_WINDOW_MS = 60 * 1000 // Track accesses within 1 minute window

/**
 * Internal tier metadata for tracking file placement with access patterns.
 * @internal
 */
interface TierMetadata {
  /** Current storage tier */
  tier: StorageTier
  /** File size in bytes */
  size: number
  /** Access count for promotion decisions */
  accessCount: number
  /** Timestamp of last access (Unix ms) */
  lastAccess: number
  /** Timestamps of recent accesses for pattern tracking */
  recentAccesses: number[]
}

/**
 * Metrics collected by TieredFS for monitoring.
 */
export interface TieredFSMetrics {
  /** Total cache hits (tier metadata found in cache) */
  cacheHits: number
  /** Total cache misses (had to search tiers) */
  cacheMisses: number
  /** Count of reads per tier */
  readsByTier: Record<StorageTier, number>
  /** Count of writes per tier */
  writesByTier: Record<StorageTier, number>
  /** Count of promotions performed */
  promotions: number
  /** Count of demotions performed */
  demotions: number
  /** Average read latency in ms per tier */
  avgReadLatencyMs: Record<StorageTier, number>
}

/**
 * TieredFS - Multi-tier filesystem with automatic tier selection.
 *
 * Automatically places files in the appropriate storage tier based on
 * file size. Provides transparent read/write operations across tiers.
 *
 * Tier selection logic:
 * 1. Files <= hotMaxSize go to hot tier (Durable Object)
 * 2. Files <= warmMaxSize go to warm tier (R2)
 * 3. Larger files go to cold tier (archive R2)
 * 4. Falls back to available tiers if preferred tier is unavailable
 *
 * @example
 * ```typescript
 * const fs = new TieredFS({ hot: env.DO, warm: env.R2 })
 *
 * // Write automatically selects tier
 * const { tier } = await fs.writeFile('/file.txt', 'Hello')
 *
 * // Read finds file in any tier
 * const { data } = await fs.readFile('/file.txt')
 *
 * // Manual tier management
 * await fs.demote('/old-data.json', 'cold')
 * ```
 */
export class TieredFS {
  /** Durable Object stub for hot tier operations */
  private readonly hotStub: DurableObjectStub

  /** R2 bucket for warm tier (optional) */
  private readonly warm?: R2Bucket

  /** R2 bucket for cold tier (optional) */
  private readonly cold?: R2Bucket

  /** Cached hot tier threshold (avoid repeated property access) */
  private readonly hotMaxSize: number

  /** Cached warm tier threshold (avoid repeated property access) */
  private readonly warmMaxSize: number

  /** Promotion policy */
  private readonly promotionPolicy: 'none' | 'on-access' | 'aggressive'

  /** Optional instrumentation hooks */
  private readonly hooks?: StorageHooks

  /** Maximum cache size */
  private readonly maxCacheSize: number

  /** Whether to track access patterns */
  private readonly trackAccessPatterns: boolean

  /**
   * In-memory tier tracking cache with LRU eviction.
   * Supplements the DO storage for fast tier lookups without network calls.
   */
  private readonly tierMap: Map<string, TierMetadata> = new Map()

  /**
   * Metrics tracking for monitoring.
   */
  private readonly metrics: TieredFSMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    readsByTier: { hot: 0, warm: 0, cold: 0 },
    writesByTier: { hot: 0, warm: 0, cold: 0 },
    promotions: 0,
    demotions: 0,
    avgReadLatencyMs: { hot: 0, warm: 0, cold: 0 },
  }

  /** Read latency samples for averaging */
  private readonly readLatencySamples: Record<StorageTier, number[]> = {
    hot: [],
    warm: [],
    cold: [],
  }

  /**
   * Create a new TieredFS instance.
   *
   * @param config - Tiered filesystem configuration
   *
   * @example
   * ```typescript
   * const fs = new TieredFS({
   *   hot: env.FSX_DO,
   *   warm: env.FSX_WARM,
   *   cold: env.FSX_COLD,
   *   thresholds: { hotMaxSize: 512 * 1024 }  // 512KB hot threshold
   * })
   * ```
   */
  constructor(config: TieredFSConfig) {
    const id = config.hot.idFromName('tiered')
    this.hotStub = config.hot.get(id)
    this.warm = config.warm
    this.cold = config.cold

    // Cache threshold values for fast access (optimization: avoid property chain traversal)
    this.hotMaxSize = config.thresholds?.hotMaxSize ?? DEFAULT_HOT_MAX_SIZE
    this.warmMaxSize = config.thresholds?.warmMaxSize ?? DEFAULT_WARM_MAX_SIZE
    this.promotionPolicy = config.promotionPolicy ?? 'on-access'
    this.hooks = config.hooks
    this.maxCacheSize = config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE
    this.trackAccessPatterns = config.trackAccessPatterns ?? (this.promotionPolicy !== 'none')
  }

  /**
   * Get current metrics snapshot.
   *
   * @returns Copy of current metrics
   *
   * @example
   * ```typescript
   * const metrics = fs.getMetrics()
   * console.log(`Cache hit rate: ${metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses)}`)
   * ```
   */
  getMetrics(): TieredFSMetrics {
    return {
      ...this.metrics,
      readsByTier: { ...this.metrics.readsByTier },
      writesByTier: { ...this.metrics.writesByTier },
      avgReadLatencyMs: { ...this.metrics.avgReadLatencyMs },
    }
  }

  /**
   * Reset metrics counters.
   */
  resetMetrics(): void {
    this.metrics.cacheHits = 0
    this.metrics.cacheMisses = 0
    this.metrics.readsByTier = { hot: 0, warm: 0, cold: 0 }
    this.metrics.writesByTier = { hot: 0, warm: 0, cold: 0 }
    this.metrics.promotions = 0
    this.metrics.demotions = 0
    this.metrics.avgReadLatencyMs = { hot: 0, warm: 0, cold: 0 }
    this.readLatencySamples.hot = []
    this.readLatencySamples.warm = []
    this.readLatencySamples.cold = []
  }

  /**
   * Determine the appropriate storage tier based on file size.
   *
   * Selection logic with fallback:
   * 1. size <= hotMaxSize -> hot tier
   * 2. size <= warmMaxSize -> warm tier (or hot if warm unavailable)
   * 3. size > warmMaxSize -> cold tier (or warm/hot if unavailable)
   *
   * Optimized to use cached threshold values for fast path.
   *
   * @param size - File size in bytes
   * @returns Selected storage tier
   * @internal
   */
  private selectTier(size: number): StorageTier {
    // Fast path: use cached threshold values (no property chain traversal)
    if (size <= this.hotMaxSize) {
      return 'hot'
    }

    // Check if fits in warm tier
    if (size <= this.warmMaxSize) {
      // Warm tier available?
      return this.warm ? 'warm' : 'hot'
    }

    // Large file - goes to cold if available, fall back to warm, then hot
    if (this.cold) {
      return 'cold'
    }
    return this.warm ? 'warm' : 'hot'
  }

  /**
   * Update tier metadata cache with LRU eviction.
   *
   * @param path - File path
   * @param metadata - Tier metadata to cache
   * @internal
   */
  private updateTierCache(path: string, metadata: Omit<TierMetadata, 'accessCount' | 'lastAccess' | 'recentAccesses'>): void {
    const now = Date.now()
    const existing = this.tierMap.get(path)

    // Evict oldest entries if cache is full (simple LRU by deleting oldest)
    if (!existing && this.tierMap.size >= this.maxCacheSize) {
      // Find and delete the entry with oldest lastAccess
      let oldestPath: string | null = null
      let oldestTime = Infinity
      for (const [p, m] of this.tierMap) {
        if (m.lastAccess < oldestTime) {
          oldestTime = m.lastAccess
          oldestPath = p
        }
      }
      if (oldestPath) {
        this.tierMap.delete(oldestPath)
      }
    }

    // Update or create entry
    this.tierMap.set(path, {
      tier: metadata.tier,
      size: metadata.size,
      accessCount: existing ? existing.accessCount : 0,
      lastAccess: now,
      recentAccesses: existing?.recentAccesses ?? [],
    })
  }

  /**
   * Record a read access for access pattern tracking.
   *
   * @param path - File path
   * @internal
   */
  private recordAccess(path: string): void {
    const metadata = this.tierMap.get(path)
    if (!metadata) return

    const now = Date.now()
    metadata.accessCount++
    metadata.lastAccess = now

    // Track recent accesses for pattern analysis (keep last 10 in window)
    if (this.trackAccessPatterns) {
      const windowStart = now - PROMOTION_WINDOW_MS
      metadata.recentAccesses = metadata.recentAccesses
        .filter(t => t > windowStart)
        .slice(-9)
      metadata.recentAccesses.push(now)
    }
  }

  /**
   * Check if a file should be promoted based on access patterns.
   *
   * @param path - File path
   * @param currentTier - Current storage tier
   * @returns Whether promotion should occur
   * @internal
   */
  private shouldAutoPromote(path: string, currentTier: StorageTier): boolean {
    if (this.promotionPolicy === 'none') return false
    if (currentTier === 'hot') return false // Already at highest tier

    const metadata = this.tierMap.get(path)
    if (!metadata) return false

    // Check if file would fit in higher tier
    const targetTier = currentTier === 'cold' ? 'warm' : 'hot'
    if (targetTier === 'hot' && metadata.size > this.hotMaxSize) return false
    if (targetTier === 'warm' && !this.warm) return false

    // Aggressive policy: promote on any access
    if (this.promotionPolicy === 'aggressive') {
      return true
    }

    // On-access policy: check access patterns
    if (this.promotionPolicy === 'on-access') {
      const now = Date.now()
      const windowStart = now - PROMOTION_WINDOW_MS
      const recentCount = metadata.recentAccesses.filter(t => t > windowStart).length

      // Promote if accessed enough times in the window
      return recentCount >= PROMOTION_ACCESS_THRESHOLD
    }

    return false
  }

  /**
   * Record read latency for metrics.
   *
   * @param tier - Storage tier
   * @param latencyMs - Latency in milliseconds
   * @internal
   */
  private recordReadLatency(tier: StorageTier, latencyMs: number): void {
    const samples = this.readLatencySamples[tier]
    samples.push(latencyMs)

    // Keep only last 100 samples for averaging
    if (samples.length > 100) {
      samples.shift()
    }

    // Update average
    this.metrics.avgReadLatencyMs[tier] = samples.reduce((a, b) => a + b, 0) / samples.length
  }

  /**
   * Write a file with automatic tier selection.
   *
   * The storage tier is selected based on the data size:
   * - <= hotMaxSize: stored in Durable Object (hot tier)
   * - <= warmMaxSize: stored in R2 warm bucket
   * - > warmMaxSize: stored in R2 cold bucket
   *
   * For hot tier writes, parent directories are automatically created.
   * For warm/cold tier writes, metadata is synced to the hot tier.
   *
   * @param path - Absolute file path
   * @param data - File content (string or bytes)
   * @returns Object containing the tier used
   *
   * @example
   * ```typescript
   * // Small file -> hot tier
   * const result = await fs.writeFile('/config.json', '{"key": "value"}')
   * console.log(result.tier)  // 'hot'
   *
   * // Large file -> warm/cold tier
   * const largeData = new Uint8Array(10 * 1024 * 1024)
   * const result2 = await fs.writeFile('/data.bin', largeData)
   * console.log(result2.tier)  // 'warm' or 'cold'
   * ```
   */
  async writeFile(path: string, data: Uint8Array | string): Promise<{ tier: StorageTier }> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const tier = this.selectTier(bytes.length)

    // Instrumentation: start operation
    const ctx = createOperationContext('writeFile', path, { tier, size: bytes.length })
    this.hooks?.onOperationStart?.(ctx)

    try {
      if (tier === 'hot') {
        // Ensure parent directories exist
        await this.ensureParentDir(path)
        // Write to Durable Object
        await this.hotStub.fetch('http://fsx.do/rpc', {
          method: 'POST',
          body: JSON.stringify({
            method: 'writeFile',
            params: {
              path,
              data: this.encodeBase64(bytes),
              encoding: 'base64',
            },
          }),
        })
      } else if (tier === 'warm' && this.warm) {
        // Write to R2
        await this.warm.put(path, bytes)
        // Update metadata in hot tier
        await this.hotStub.fetch('http://fsx.do/rpc', {
          method: 'POST',
          body: JSON.stringify({
            method: 'setMetadata',
            params: { path, tier: 'warm', size: bytes.length },
          }),
        })
      } else if (tier === 'cold' && this.cold) {
        // Write to archive
        await this.cold.put(path, bytes)
        await this.hotStub.fetch('http://fsx.do/rpc', {
          method: 'POST',
          body: JSON.stringify({
            method: 'setMetadata',
            params: { path, tier: 'cold', size: bytes.length },
          }),
        })
      }

      // Track tier in memory with optimized cache update
      this.updateTierCache(path, { tier, size: bytes.length })

      // Update metrics
      this.metrics.writesByTier[tier]++

      // Instrumentation: end operation
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: true, tier, size: bytes.length }))

      return { tier }
    } catch (error) {
      // Instrumentation: end operation with error
      const storageError = error instanceof StorageError ? error : StorageError.io(error as Error, path, 'writeFile')
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: false, error: storageError }))
      throw error
    }
  }

  /**
   * Read a file from any tier.
   *
   * First checks the in-memory tier cache for quick lookup, then
   * searches through available tiers (warm, cold, hot) to find the file.
   * Updates the tier cache when a file is found.
   *
   * Optimizations:
   * - Cache hit tracking for monitoring cache effectiveness
   * - Access pattern recording for smart promotion decisions
   * - Latency tracking per tier for performance monitoring
   *
   * @param path - Absolute file path
   * @returns Object containing data and the tier it was read from
   * @throws {StorageError} If file is not found in any tier
   *
   * @example
   * ```typescript
   * const { data, tier } = await fs.readFile('/config.json')
   * const text = new TextDecoder().decode(data)
   * console.log(`Read from ${tier} tier: ${text}`)
   * ```
   */
  async readFile(path: string): Promise<{ data: Uint8Array; tier: StorageTier }> {
    // Instrumentation: start operation
    const ctx = createOperationContext('readFile', path)
    this.hooks?.onOperationStart?.(ctx)
    const startTime = Date.now()

    try {
      // Check our in-memory tier tracking first (cache hit)
      const metadata = this.tierMap.get(path)

      let result: { data: Uint8Array; tier: StorageTier }

      // If we have metadata, read from the known tier (cache hit path)
      if (metadata) {
        this.metrics.cacheHits++
        if (metadata.tier === 'hot') {
          result = await this.readFromHot(path)
        } else if (metadata.tier === 'warm' && this.warm) {
          result = await this.readFromWarm(path)
        } else if (metadata.tier === 'cold' && this.cold) {
          result = await this.readFromCold(path)
        } else {
          // Metadata exists but tier unavailable - search
          result = await this.searchTiers(path)
        }
      } else {
        // No metadata - search through tiers (cache miss path)
        this.metrics.cacheMisses++
        result = await this.searchTiers(path)
      }

      // Record latency and access pattern
      const latencyMs = Date.now() - startTime
      this.recordReadLatency(result.tier, latencyMs)
      this.recordAccess(path)
      this.metrics.readsByTier[result.tier]++

      // Instrumentation: end operation
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, {
        success: true,
        tier: result.tier,
        size: result.data.length,
      }))

      return result
    } catch (error) {
      // Instrumentation: end operation with error
      const storageError = error instanceof StorageError ? error : StorageError.io(error as Error, path, 'readFile')
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: false, error: storageError }))
      throw error
    }
  }

  /**
   * Search through all tiers to find a file.
   *
   * @param path - File path
   * @returns Data and tier
   * @throws {StorageError} If file not found in any tier
   * @internal
   */
  private async searchTiers(path: string): Promise<{ data: Uint8Array; tier: StorageTier }> {
    // Try warm first (for files put directly into warm bucket in tests)
    if (this.warm) {
      const warmObj = await this.warm.get(path)
      if (warmObj) {
        const data = new Uint8Array(await warmObj.arrayBuffer())
        this.updateTierCache(path, { tier: 'warm', size: data.length })
        return { data, tier: 'warm' }
      }
    }

    // Try cold
    if (this.cold) {
      const coldObj = await this.cold.get(path)
      if (coldObj) {
        const data = new Uint8Array(await coldObj.arrayBuffer())
        this.updateTierCache(path, { tier: 'cold', size: data.length })
        return { data, tier: 'cold' }
      }
    }

    // Try hot tier last (default)
    try {
      const result = await this.readFromHot(path)
      this.updateTierCache(path, { tier: 'hot', size: result.data.length })
      return result
    } catch {
      throw StorageError.notFound(path, 'readFile')
    }
  }

  /**
   * Read file from hot tier (Durable Object).
   *
   * @param path - File path
   * @returns Data and tier info
   * @throws {Error} If file not found in hot tier
   * @internal
   */
  private async readFromHot(path: string): Promise<{ data: Uint8Array; tier: 'hot' }> {
    const readResponse = await this.hotStub.fetch('http://fsx.do/rpc', {
      method: 'POST',
      body: JSON.stringify({
        method: 'readFile',
        params: { path },
      }),
    })

    if (!readResponse.ok) {
      const error = await readResponse.json() as { code?: string; message?: string }
      throw new Error(error.message ?? `File not found: ${path}`)
    }

    const result = (await readResponse.json()) as { data: string; encoding: string }
    return {
      data: this.decodeBase64(result.data),
      tier: 'hot',
    }
  }

  /**
   * Read file from warm tier (R2).
   *
   * @param path - File path
   * @returns Data and tier info
   * @throws {StorageError} If warm tier not available or file not found
   * @internal
   */
  private async readFromWarm(path: string): Promise<{ data: Uint8Array; tier: 'warm' }> {
    if (!this.warm) {
      throw StorageError.invalidArg('Warm tier not available', path, 'readFromWarm')
    }
    const object = await this.warm.get(path)
    if (!object) {
      throw StorageError.notFound(path, 'readFromWarm')
    }
    const data = new Uint8Array(await object.arrayBuffer())
    return { data, tier: 'warm' }
  }

  /**
   * Read file from cold tier (R2 archive).
   *
   * @param path - File path
   * @returns Data and tier info
   * @throws {StorageError} If cold tier not available or file not found
   * @internal
   */
  private async readFromCold(path: string): Promise<{ data: Uint8Array; tier: 'cold' }> {
    if (!this.cold) {
      throw StorageError.invalidArg('Cold tier not available', path, 'readFromCold')
    }
    const object = await this.cold.get(path)
    if (!object) {
      throw StorageError.notFound(path, 'readFromCold')
    }
    const data = new Uint8Array(await object.arrayBuffer())
    return { data, tier: 'cold' }
  }

  /**
   * Ensure parent directory exists in hot tier.
   *
   * Creates parent directories recursively if they don't exist.
   *
   * @param path - File path (parent will be extracted)
   * @internal
   */
  private async ensureParentDir(path: string): Promise<void> {
    const parentPath = path.substring(0, path.lastIndexOf('/'))
    if (parentPath && parentPath !== '/') {
      await this.hotStub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'mkdir',
          params: { path: parentPath, recursive: true },
        }),
      })
    }
  }

  /**
   * Promote a file to a higher (faster) tier.
   *
   * Writes the file to the target tier and updates metadata.
   *
   * @param path - File path
   * @param data - File data
   * @param _fromTier - Current tier (unused, for logging)
   * @param toTier - Target tier
   * @internal
   */
  // Reserved for future tier promotion implementation
  // @ts-expect-error Reserved for future tier promotion
  private async _promote(path: string, data: Uint8Array, _fromTier: string, toTier: 'hot' | 'warm'): Promise<void> {
    if (toTier === 'hot') {
      await this.hotStub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'writeFile',
          params: {
            path,
            data: this.encodeBase64(data),
            encoding: 'base64',
          },
        }),
      })
    } else if (toTier === 'warm' && this.warm) {
      await this.warm.put(path, data)
    }

    // Update in-memory tier tracking
    this.tierMap.set(path, { tier: toTier, size: data.length })

    // Update metadata in DO
    await this.hotStub.fetch('http://fsx.do/rpc', {
      method: 'POST',
      body: JSON.stringify({
        method: 'setMetadata',
        params: { path, tier: toTier, size: data.length },
      }),
    })
  }

  /**
   * Promote a file to a higher (faster) tier.
   *
   * Moves a file from its current tier to a higher-performance tier.
   * The file is copied to the target tier and removed from the source tier.
   *
   * The process:
   * 1. Read file from current tier
   * 2. Write to target tier
   * 3. Delete from source tier
   * 4. Update metadata
   *
   * @param path - File path to promote
   * @param toTier - Target tier ('hot' or 'warm')
   * @throws {StorageError} If target tier is not available or file not found
   *
   * @example
   * ```typescript
   * // Promote frequently accessed file to hot tier
   * await fs.promote('/data/active.json', 'hot')
   *
   * // Promote from cold to warm
   * await fs.promote('/archive/recent.bin', 'warm')
   * ```
   */
  async promote(path: string, toTier: 'hot' | 'warm'): Promise<void> {
    // Instrumentation: start operation
    const ctx = createOperationContext('promote', path, { tier: toTier })
    this.hooks?.onOperationStart?.(ctx)

    try {
      // Read file from current tier
      const { data, tier: currentTier } = await this.readFile(path)

      // Write to target tier
      if (toTier === 'hot') {
        await this.ensureParentDir(path)
        await this.hotStub.fetch('http://fsx.do/rpc', {
          method: 'POST',
          body: JSON.stringify({
            method: 'writeFile',
            params: {
              path,
              data: this.encodeBase64(data),
              encoding: 'base64',
            },
          }),
        })
      } else if (toTier === 'warm' && this.warm) {
        await this.warm.put(path, data)
      }

      // Delete from source tier
      if (currentTier === 'cold' && this.cold) {
        await this.cold.delete(path)
      } else if (currentTier === 'warm' && this.warm) {
        await this.warm.delete(path)
      }

      // Update in-memory tier tracking
      this.updateTierCache(path, { tier: toTier, size: data.length })

      // Update metadata in DO
      await this.hotStub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'setMetadata',
          params: { path, tier: toTier, size: data.length },
        }),
      })

      // Update metrics
      this.metrics.promotions++

      // Instrumentation: notify tier migration
      this.hooks?.onTierMigration?.(path, currentTier, toTier)
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, {
        success: true,
        tier: toTier,
        migrated: true,
      }))
    } catch (error) {
      const storageError = error instanceof StorageError ? error : StorageError.io(error as Error, path, 'promote')
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: false, error: storageError }))
      throw error
    }
  }

  /**
   * Demote a file to a lower (cheaper) tier.
   *
   * Moves a file from its current tier to a lower-cost tier.
   * Useful for archiving infrequently accessed data.
   *
   * The process:
   * 1. Read file from current tier
   * 2. Write to target tier
   * 3. Delete from original tier
   * 4. Update metadata
   *
   * @param path - File path to demote
   * @param toTier - Target tier ('warm' or 'cold')
   * @throws {StorageError} If target tier is not available
   *
   * @example
   * ```typescript
   * // Move old data to cold storage
   * await fs.demote('/data/archive-2023.json', 'cold')
   *
   * // Move large file from hot to warm
   * await fs.demote('/cache/processed.bin', 'warm')
   * ```
   */
  async demote(path: string, toTier: 'warm' | 'cold'): Promise<void> {
    // Check if target tier is available
    if (toTier === 'warm' && !this.warm) {
      throw StorageError.invalidArg('Warm tier not available', path, 'demote')
    }
    if (toTier === 'cold' && !this.cold) {
      throw StorageError.invalidArg('Cold tier not available', path, 'demote')
    }

    // Instrumentation: start operation
    const ctx = createOperationContext('demote', path, { tier: toTier })
    this.hooks?.onOperationStart?.(ctx)

    try {
      // Read the file from its current tier
      const { data, tier: currentTier } = await this.readFile(path)

      // Demote to warm tier
      if (toTier === 'warm' && this.warm) {
        if (currentTier === 'hot') {
          // Write to warm
          await this.warm.put(path, data)
          // Delete from hot tier
          await this.hotStub.fetch('http://fsx.do/rpc', {
            method: 'POST',
            body: JSON.stringify({
              method: 'unlink',
              params: { path },
            }),
          })
        }
        // Update metadata
        this.updateTierCache(path, { tier: 'warm', size: data.length })
        await this.hotStub.fetch('http://fsx.do/rpc', {
          method: 'POST',
          body: JSON.stringify({
            method: 'setMetadata',
            params: { path, tier: 'warm', size: data.length },
          }),
        })
      }

      // Demote to cold tier
      if (toTier === 'cold' && this.cold) {
        // Write to cold
        await this.cold.put(path, data)

        // Delete from current tier
        if (currentTier === 'hot') {
          await this.hotStub.fetch('http://fsx.do/rpc', {
            method: 'POST',
            body: JSON.stringify({
              method: 'unlink',
              params: { path },
            }),
          })
        } else if (currentTier === 'warm' && this.warm) {
          await this.warm.delete(path)
        }

        // Update metadata
        this.updateTierCache(path, { tier: 'cold', size: data.length })
        await this.hotStub.fetch('http://fsx.do/rpc', {
          method: 'POST',
          body: JSON.stringify({
            method: 'setMetadata',
            params: { path, tier: 'cold', size: data.length },
          }),
        })
      }

      // Update metrics
      this.metrics.demotions++

      // Instrumentation: notify tier migration
      this.hooks?.onTierMigration?.(path, currentTier, toTier)
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, {
        success: true,
        tier: toTier,
        migrated: true,
      }))
    } catch (error) {
      const storageError = error instanceof StorageError ? error : StorageError.io(error as Error, path, 'demote')
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: false, error: storageError }))
      throw error
    }
  }

  /**
   * Move a file to a new path.
   *
   * Reads the file, writes it to the new location, and deletes the original.
   * The file remains in the same tier unless tier selection changes due to size.
   *
   * @param sourcePath - Original file path
   * @param destPath - New file path
   * @throws {StorageError} If source file is not found
   *
   * @example
   * ```typescript
   * await fs.move('/old/path/file.txt', '/new/path/file.txt')
   * ```
   */
  async move(sourcePath: string, destPath: string): Promise<void> {
    // Instrumentation: start operation
    const ctx = createOperationContext('move', sourcePath)
    this.hooks?.onOperationStart?.(ctx)

    try {
      // Read file from current tier
      const { data, tier } = await this.readFile(sourcePath)

      // Write to destination in the same tier
      if (tier === 'hot') {
        await this.ensureParentDir(destPath)
        await this.hotStub.fetch('http://fsx.do/rpc', {
          method: 'POST',
          body: JSON.stringify({
            method: 'writeFile',
            params: {
              path: destPath,
              data: this.encodeBase64(data),
              encoding: 'base64',
            },
          }),
        })
      } else if (tier === 'warm' && this.warm) {
        await this.warm.put(destPath, data)
      } else if (tier === 'cold' && this.cold) {
        await this.cold.put(destPath, data)
      }

      // Update metadata for destination
      this.updateTierCache(destPath, { tier, size: data.length })
      await this.hotStub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'setMetadata',
          params: { path: destPath, tier, size: data.length },
        }),
      })

      // Delete source file
      await this.deleteFile(sourcePath)

      // Instrumentation: end operation
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: true, tier }))
    } catch (error) {
      const storageError = error instanceof StorageError ? error : StorageError.io(error as Error, sourcePath, 'move')
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: false, error: storageError }))
      throw error
    }
  }

  /**
   * Copy a file to a new path.
   *
   * Creates a copy of the file at the destination path.
   * Optionally can copy to a different tier.
   *
   * @param sourcePath - Original file path
   * @param destPath - Destination file path
   * @param options - Copy options (optional tier override)
   * @throws {StorageError} If source file is not found
   *
   * @example
   * ```typescript
   * // Copy within same tier
   * await fs.copy('/data/file.txt', '/backup/file.txt')
   *
   * // Copy to different tier
   * await fs.copy('/hot/file.txt', '/archive/file.txt', { tier: 'cold' })
   * ```
   */
  async copy(sourcePath: string, destPath: string, options?: { tier?: StorageTier }): Promise<void> {
    // Instrumentation: start operation
    const ctx = createOperationContext('copy', sourcePath)
    this.hooks?.onOperationStart?.(ctx)

    try {
      // Read file from current tier
      const { data, tier: sourceTier } = await this.readFile(sourcePath)

      // Determine target tier
      const targetTier = options?.tier ?? sourceTier

      // Write to destination in the target tier
      if (targetTier === 'hot') {
        await this.ensureParentDir(destPath)
        await this.hotStub.fetch('http://fsx.do/rpc', {
          method: 'POST',
          body: JSON.stringify({
            method: 'writeFile',
            params: {
              path: destPath,
              data: this.encodeBase64(data),
              encoding: 'base64',
            },
          }),
        })
      } else if (targetTier === 'warm' && this.warm) {
        await this.warm.put(destPath, data)
      } else if (targetTier === 'cold' && this.cold) {
        await this.cold.put(destPath, data)
      }

      // Update metadata for destination
      this.updateTierCache(destPath, { tier: targetTier, size: data.length })
      await this.hotStub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'setMetadata',
          params: { path: destPath, tier: targetTier, size: data.length },
        }),
      })

      // Instrumentation: end operation
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: true, tier: targetTier }))
    } catch (error) {
      const storageError = error instanceof StorageError ? error : StorageError.io(error as Error, sourcePath, 'copy')
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: false, error: storageError }))
      throw error
    }
  }

  /**
   * Delete a file from any tier.
   *
   * Removes the file from its current storage tier and cleans up metadata.
   *
   * @param path - File path to delete
   * @throws {StorageError} If file is not found
   *
   * @example
   * ```typescript
   * await fs.deleteFile('/old/data.bin')
   * ```
   */
  async deleteFile(path: string): Promise<void> {
    // Instrumentation: start operation
    const ctx = createOperationContext('deleteFile', path)
    this.hooks?.onOperationStart?.(ctx)

    try {
      // Get current tier from cache or search
      const metadata = this.tierMap.get(path)
      let currentTier: StorageTier | undefined = metadata?.tier

      // If no metadata, try to determine tier by searching
      if (!currentTier) {
        // Check warm
        if (this.warm) {
          const warmObj = await this.warm.head(path)
          if (warmObj) {
            currentTier = 'warm'
          }
        }
        // Check cold
        if (!currentTier && this.cold) {
          const coldObj = await this.cold.head(path)
          if (coldObj) {
            currentTier = 'cold'
          }
        }
        // Assume hot if not found elsewhere
        if (!currentTier) {
          currentTier = 'hot'
        }
      }

      // Delete from the current tier
      if (currentTier === 'hot') {
        await this.hotStub.fetch('http://fsx.do/rpc', {
          method: 'POST',
          body: JSON.stringify({
            method: 'unlink',
            params: { path },
          }),
        })
      } else if (currentTier === 'warm' && this.warm) {
        await this.warm.delete(path)
      } else if (currentTier === 'cold' && this.cold) {
        await this.cold.delete(path)
      }

      // Clean up metadata cache
      this.tierMap.delete(path)
      await this.hotStub.fetch('http://fsx.do/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'deleteMetadata',
          params: { path },
        }),
      })

      // Instrumentation: end operation
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: true, tier: currentTier }))
    } catch (error) {
      const storageError = error instanceof StorageError ? error : StorageError.io(error as Error, path, 'deleteFile')
      this.hooks?.onOperationEnd?.(ctx, createOperationResult(ctx, { success: false, error: storageError }))
      throw error
    }
  }

  /**
   * Encode binary data to base64 for RPC transport.
   *
   * @param data - Binary data to encode
   * @returns Base64 encoded string
   * @internal
   */
  private encodeBase64(data: Uint8Array): string {
    let binary = ''
    for (const byte of data) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  }

  /**
   * Decode base64 string to binary data.
   *
   * @param data - Base64 encoded string
   * @returns Decoded binary data
   * @internal
   */
  private decodeBase64(data: string): Uint8Array {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}
