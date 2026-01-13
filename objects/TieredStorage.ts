/**
 * TieredStorage - Transparent Tiered Storage for Durable Objects
 *
 * Provides automatic migration between storage tiers based on access patterns:
 * - Hot tier (in-memory): Frequently accessed data, lowest latency
 * - Warm tier (SQLite): Recent but less frequent data, moderate latency
 * - Cold tier (R2): Archived/old data, higher latency
 *
 * Key features:
 * - Automatic promotion from cold/warm to hot on access
 * - Automatic demotion from hot to warm to cold based on TTL/access patterns
 * - Unified API regardless of current tier
 * - No data loss during tier migration
 * - Access pattern tracking for intelligent tier placement
 *
 * @example
 * ```typescript
 * const storage = new TieredStorage(state, env)
 *
 * // Basic usage - tier is transparent
 * await storage.set('user:123', userData)
 * const user = await storage.get('user:123')
 *
 * // Check current tier
 * const tier = await storage.getCurrentTier('user:123')
 *
 * // Manual tier control
 * await storage.promoteToHot('archive:doc')
 * await storage.demoteToCold('old:data')
 *
 * // Access statistics
 * const stats = storage.getAccessStats('user:123')
 * ```
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/** Storage tier identifiers */
export type StorageTier = 'hot' | 'warm' | 'cold'

/** Configuration for each storage tier */
export interface TierConfig {
  hot: {
    /** Maximum number of items in hot tier */
    maxItems: number
    /** Maximum age (ms) before demotion consideration */
    maxAge: number
  }
  warm: {
    /** Maximum number of items in warm tier */
    maxItems: number
    /** Maximum age (ms) before demotion to cold */
    maxAge: number
  }
  cold: {
    /** Backend for cold storage */
    backend: 'r2' | 'sqlite'
  }
}

/** Access statistics for a key */
export interface AccessStats {
  /** Number of times the key has been accessed */
  accessCount: number
  /** Timestamp of last access */
  lastAccess: number
  /** Current storage tier */
  currentTier: StorageTier
  /** Timestamp when the key was created */
  createdAt: number
  /** Timestamp when promoted to hot (if applicable) */
  promotedAt?: number
  /** Timestamp when demoted (if applicable) */
  demotedAt?: number
}

/** Result of a migration operation */
export interface MigrationResult {
  /** Key that was migrated */
  key: string
  /** Source tier */
  from: StorageTier
  /** Destination tier */
  to: StorageTier
  /** Duration of migration in ms */
  durationMs: number
  /** Whether migration succeeded */
  success: boolean
}

/** Options for set operations */
export interface SetOptions {
  /** Target tier (default: hot) */
  tier?: StorageTier
}

/** Latency metrics per tier */
export interface LatencyMetrics {
  hot: { avgMs: number; minMs: number; maxMs: number; samples: number }
  warm: { avgMs: number; minMs: number; maxMs: number; samples: number }
  cold: { avgMs: number; minMs: number; maxMs: number; samples: number }
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

/** Error thrown when a key is not found in any tier */
export class TierNotFoundError extends Error {
  constructor(key: string) {
    super(`Key '${key}' not found in any storage tier`)
    this.name = 'TierNotFoundError'
  }
}

/** Error thrown when a migration operation fails */
export class MigrationError extends Error {
  constructor(key: string, from: StorageTier, to: StorageTier, cause?: Error) {
    super(`Failed to migrate '${key}' from ${from} to ${to}${cause ? `: ${cause.message}` : ''}`)
    this.name = 'MigrationError'
    this.cause = cause
  }
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

/** Internal metadata stored with each entry */
interface EntryMetadata {
  tier: StorageTier
  accessCount: number
  lastAccess: number
  createdAt: number
  promotedAt?: number
  demotedAt?: number
}

/** Internal entry format */
interface StoredEntry<T = unknown> {
  value: T
  metadata: EntryMetadata
}

/** Latency sample for metrics */
interface LatencySample {
  tier: StorageTier
  durationMs: number
  timestamp: number
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: TierConfig = {
  hot: {
    maxItems: 1000,
    maxAge: 300000, // 5 minutes
  },
  warm: {
    maxItems: 10000,
    maxAge: 3600000, // 1 hour
  },
  cold: {
    backend: 'r2',
  },
}

// ============================================================================
// TIERED STORAGE CLASS
// ============================================================================

/**
 * TieredStorage - Transparent tiered storage for Durable Objects
 *
 * Automatically manages data across hot (memory), warm (SQLite), and cold (R2) tiers.
 */
export class TieredStorage {
  private state: DurableObjectState
  private env: {
    R2_COLD_STORAGE?: {
      put(key: string, value: unknown): Promise<void>
      get(key: string): Promise<{ json(): Promise<unknown> } | null>
      delete(key: string): Promise<boolean>
    }
    [key: string]: unknown
  }
  private config: TierConfig

  // Hot tier: in-memory cache
  private hotCache = new Map<string, StoredEntry>()

  // Warm tier: SQLite via DO storage (metadata tracked separately)
  private warmKeys = new Set<string>()

  // Cold tier: R2 (metadata tracked separately)
  private coldKeys = new Set<string>()

  // Metadata tracking for keys in non-hot tiers (persists promotion/demotion times)
  private metadataCache = new Map<string, EntryMetadata>()

  // Latency tracking
  private latencySamples: LatencySample[] = []
  private readonly maxLatencySamples = 1000

  constructor(
    state: DurableObjectState,
    env: {
      R2_COLD_STORAGE?: {
        put(key: string, value: unknown): Promise<void>
        get(key: string): Promise<{ json(): Promise<unknown> } | null>
        delete(key: string): Promise<boolean>
      }
      [key: string]: unknown
    },
    config: Partial<TierConfig> = {}
  ) {
    this.state = state
    this.env = env
    this.config = {
      hot: { ...DEFAULT_CONFIG.hot, ...config.hot },
      warm: { ...DEFAULT_CONFIG.warm, ...config.warm },
      cold: { ...DEFAULT_CONFIG.cold, ...config.cold },
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a value from storage (tier-transparent)
   * Automatically promotes data to hot tier on access
   */
  async get<T>(key: string): Promise<T | undefined> {
    const start = performance.now()

    // Check hot tier first
    if (this.hotCache.has(key)) {
      const entry = this.hotCache.get(key)!
      this.recordAccess(entry)
      this.recordLatency('hot', performance.now() - start)
      return entry.value as T
    }

    // Check warm tier (SQLite)
    if (this.warmKeys.has(key)) {
      const stored = await this.state.storage.get<StoredEntry<T>>(`tiered:warm:${key}`)
      if (stored) {
        this.recordLatency('warm', performance.now() - start)
        // Promote to hot on access
        await this.promoteInternal(key, stored, 'warm')
        return stored.value
      }
    }

    // Check cold tier (R2)
    if (this.coldKeys.has(key)) {
      const value = await this.getFromCold<T>(key)
      if (value !== undefined) {
        this.recordLatency('cold', performance.now() - start)
        // Promote to hot on access
        const entry: StoredEntry<T> = {
          value,
          metadata: {
            tier: 'cold',
            accessCount: 1,
            lastAccess: Date.now(),
            createdAt: Date.now(),
          },
        }
        await this.promoteInternal(key, entry, 'cold')
        return value
      }
    }

    return undefined
  }

  /**
   * Set a value in storage with optional tier specification
   */
  async set<T>(key: string, value: T, options: SetOptions = {}): Promise<void> {
    const tier = options.tier ?? 'hot'
    const now = Date.now()

    const entry: StoredEntry<T> = {
      value,
      metadata: {
        tier,
        accessCount: 0,
        lastAccess: now,
        createdAt: now,
      },
    }

    // Remove from other tiers if exists
    await this.removeFromAllTiers(key)

    // Store in target tier
    switch (tier) {
      case 'hot':
        await this.setInHot(key, entry)
        break
      case 'warm':
        await this.setInWarm(key, entry)
        break
      case 'cold':
        await this.setInCold(key, entry)
        break
    }
  }

  /**
   * Delete a key from all tiers
   */
  async delete(key: string): Promise<boolean> {
    let deleted = false

    if (this.hotCache.has(key)) {
      this.hotCache.delete(key)
      deleted = true
    }

    if (this.warmKeys.has(key)) {
      await this.state.storage.delete(`tiered:warm:${key}`)
      this.warmKeys.delete(key)
      deleted = true
    }

    if (this.coldKeys.has(key)) {
      await this.deleteFromCold(key)
      this.coldKeys.delete(key)
      deleted = true
    }

    return deleted
  }

  /**
   * Check if a key exists in any tier
   */
  async has(key: string): Promise<boolean> {
    if (this.hotCache.has(key)) return true
    if (this.warmKeys.has(key)) return true
    if (this.coldKeys.has(key)) return true
    return false
  }

  /**
   * Get the current tier of a key
   */
  async getCurrentTier(key: string): Promise<StorageTier | null> {
    if (this.hotCache.has(key)) return 'hot'
    if (this.warmKeys.has(key)) return 'warm'
    if (this.coldKeys.has(key)) return 'cold'
    return null
  }

  /**
   * Get access statistics for a key (sync method - uses metadata cache for non-hot tiers)
   */
  getAccessStats(key: string): AccessStats | undefined {
    // Check hot tier first
    const entry = this.hotCache.get(key)
    if (entry) {
      return {
        accessCount: entry.metadata.accessCount,
        lastAccess: entry.metadata.lastAccess,
        currentTier: entry.metadata.tier,
        createdAt: entry.metadata.createdAt,
        promotedAt: entry.metadata.promotedAt,
        demotedAt: entry.metadata.demotedAt,
      }
    }

    // Check metadata cache for warm/cold tier entries
    const metadata = this.metadataCache.get(key)
    if (metadata) {
      return {
        accessCount: metadata.accessCount,
        lastAccess: metadata.lastAccess,
        currentTier: metadata.tier,
        createdAt: metadata.createdAt,
        promotedAt: metadata.promotedAt,
        demotedAt: metadata.demotedAt,
      }
    }

    return undefined
  }

  /**
   * Get access statistics for a key (async - supports all tiers)
   */
  async getAccessStatsAsync(key: string): Promise<AccessStats | undefined> {
    // Check hot tier first (synchronous)
    const hotEntry = this.hotCache.get(key)
    if (hotEntry) {
      return {
        accessCount: hotEntry.metadata.accessCount,
        lastAccess: hotEntry.metadata.lastAccess,
        currentTier: hotEntry.metadata.tier,
        createdAt: hotEntry.metadata.createdAt,
        promotedAt: hotEntry.metadata.promotedAt,
        demotedAt: hotEntry.metadata.demotedAt,
      }
    }

    // Check warm tier
    if (this.warmKeys.has(key)) {
      const stored = await this.state.storage.get<StoredEntry>(`tiered:warm:${key}`)
      if (stored) {
        return {
          accessCount: stored.metadata.accessCount,
          lastAccess: stored.metadata.lastAccess,
          currentTier: stored.metadata.tier,
          createdAt: stored.metadata.createdAt,
          promotedAt: stored.metadata.promotedAt,
          demotedAt: stored.metadata.demotedAt,
        }
      }
    }

    // Check cold tier (metadata not directly available in R2, return basic stats)
    if (this.coldKeys.has(key)) {
      return {
        accessCount: 0,
        lastAccess: 0,
        currentTier: 'cold',
        createdAt: 0,
      }
    }

    return undefined
  }

  /**
   * Manually promote a key to hot tier
   */
  async promoteToHot(key: string): Promise<void> {
    const tier = await this.getCurrentTier(key)
    if (tier === null) {
      throw new TierNotFoundError(key)
    }
    if (tier === 'hot') {
      return // Already in hot
    }

    if (tier === 'warm') {
      const stored = await this.state.storage.get<StoredEntry>(`tiered:warm:${key}`)
      if (stored) {
        await this.promoteInternal(key, stored, 'warm')
      }
    } else if (tier === 'cold') {
      const value = await this.getFromCold(key)
      if (value !== undefined) {
        const entry: StoredEntry = {
          value,
          metadata: {
            tier: 'cold',
            accessCount: 0,
            lastAccess: Date.now(),
            createdAt: Date.now(),
          },
        }
        await this.promoteInternal(key, entry, 'cold')
      }
    }
  }

  /**
   * Manually demote a key to cold tier
   */
  async demoteToCold(key: string): Promise<void> {
    const tier = await this.getCurrentTier(key)
    if (tier === null) {
      throw new TierNotFoundError(key)
    }
    if (tier === 'cold') {
      return // Already in cold
    }

    let entry: StoredEntry | undefined

    if (tier === 'hot') {
      entry = this.hotCache.get(key)
    } else if (tier === 'warm') {
      entry = await this.state.storage.get<StoredEntry>(`tiered:warm:${key}`)
    }

    if (entry) {
      try {
        await this.demoteInternal(key, entry, tier, 'cold')
      } catch (error) {
        throw new MigrationError(key, tier, 'cold', error instanceof Error ? error : undefined)
      }
    }
  }

  /**
   * Run maintenance to demote stale data
   */
  async runMaintenance(): Promise<void> {
    const now = Date.now()

    // Check hot tier for items to demote to warm
    for (const [key, entry] of this.hotCache) {
      const age = now - entry.metadata.lastAccess
      if (age > this.config.hot.maxAge) {
        await this.demoteInternal(key, entry, 'hot', 'warm')
      }
    }

    // Check warm tier for items to demote to cold
    for (const key of this.warmKeys) {
      const stored = await this.state.storage.get<StoredEntry>(`tiered:warm:${key}`)
      if (stored) {
        const age = now - stored.metadata.lastAccess
        if (age > this.config.warm.maxAge) {
          await this.demoteInternal(key, stored, 'warm', 'cold')
        }
      }
    }
  }

  /**
   * Get latency metrics per tier
   */
  async getLatencyMetrics(): Promise<LatencyMetrics> {
    const calculateStats = (samples: number[]) => {
      if (samples.length === 0) {
        return { avgMs: 0, minMs: 0, maxMs: 0, samples: 0 }
      }
      return {
        avgMs: samples.reduce((a, b) => a + b, 0) / samples.length,
        minMs: Math.min(...samples),
        maxMs: Math.max(...samples),
        samples: samples.length,
      }
    }

    const hotSamples = this.latencySamples.filter(s => s.tier === 'hot').map(s => s.durationMs)
    const warmSamples = this.latencySamples.filter(s => s.tier === 'warm').map(s => s.durationMs)
    const coldSamples = this.latencySamples.filter(s => s.tier === 'cold').map(s => s.durationMs)

    return {
      hot: calculateStats(hotSamples),
      warm: calculateStats(warmSamples),
      cold: calculateStats(coldSamples),
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): TierConfig {
    return { ...this.config }
  }

  /**
   * Update configuration at runtime
   */
  async updateConfig(updates: Partial<TierConfig>): Promise<void> {
    if (updates.hot) {
      this.config.hot = { ...this.config.hot, ...updates.hot }
    }
    if (updates.warm) {
      this.config.warm = { ...this.config.warm, ...updates.warm }
    }
    if (updates.cold) {
      this.config.cold = { ...this.config.cold, ...updates.cold }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private recordAccess(entry: StoredEntry): void {
    entry.metadata.accessCount++
    entry.metadata.lastAccess = Date.now()
  }

  private recordLatency(tier: StorageTier, durationMs: number): void {
    this.latencySamples.push({
      tier,
      durationMs,
      timestamp: Date.now(),
    })

    // Keep samples bounded
    if (this.latencySamples.length > this.maxLatencySamples) {
      this.latencySamples.shift()
    }
  }

  private async removeFromAllTiers(key: string): Promise<void> {
    this.hotCache.delete(key)
    this.metadataCache.delete(key)
    if (this.warmKeys.has(key)) {
      await this.state.storage.delete(`tiered:warm:${key}`)
      this.warmKeys.delete(key)
    }
    if (this.coldKeys.has(key)) {
      await this.deleteFromCold(key)
      this.coldKeys.delete(key)
    }
  }

  private async setInHot<T>(key: string, entry: StoredEntry<T>): Promise<void> {
    entry.metadata.tier = 'hot'

    // Check if we need to evict from hot tier
    if (this.hotCache.size >= this.config.hot.maxItems) {
      await this.evictFromHot()
    }

    this.hotCache.set(key, entry)
  }

  private async setInWarm<T>(key: string, entry: StoredEntry<T>): Promise<void> {
    entry.metadata.tier = 'warm'
    await this.state.storage.put(`tiered:warm:${key}`, entry)
    this.warmKeys.add(key)
  }

  private async setInCold<T>(key: string, entry: StoredEntry<T>): Promise<void> {
    entry.metadata.tier = 'cold'
    await this.putToCold(key, entry)
    this.coldKeys.add(key)
  }

  private async evictFromHot(): Promise<void> {
    // Find least recently used entry
    let oldestKey: string | null = null
    let oldestAccess = Infinity

    for (const [key, entry] of this.hotCache) {
      if (entry.metadata.lastAccess < oldestAccess) {
        oldestAccess = entry.metadata.lastAccess
        oldestKey = key
      }
    }

    if (oldestKey) {
      const entry = this.hotCache.get(oldestKey)!
      await this.demoteInternal(oldestKey, entry, 'hot', 'warm')
    }
  }

  private async promoteInternal(key: string, entry: StoredEntry, fromTier: StorageTier): Promise<void> {
    const now = Date.now()

    // Update metadata
    entry.metadata.tier = 'hot'
    entry.metadata.accessCount++
    entry.metadata.lastAccess = now
    entry.metadata.promotedAt = now

    // Check if we need to evict from hot tier first
    if (this.hotCache.size >= this.config.hot.maxItems) {
      await this.evictFromHot()
    }

    // Add to hot tier
    this.hotCache.set(key, entry)

    // Clear from metadata cache (now in hot cache)
    this.metadataCache.delete(key)

    // Remove from source tier
    if (fromTier === 'warm') {
      await this.state.storage.delete(`tiered:warm:${key}`)
      this.warmKeys.delete(key)
    } else if (fromTier === 'cold') {
      await this.deleteFromCold(key)
      this.coldKeys.delete(key)
    }
  }

  private async demoteInternal(
    key: string,
    entry: StoredEntry,
    fromTier: StorageTier,
    toTier: StorageTier
  ): Promise<void> {
    const now = Date.now()

    // Update metadata
    entry.metadata.tier = toTier
    entry.metadata.demotedAt = now

    // Store metadata in cache for sync access (getAccessStats)
    this.metadataCache.set(key, { ...entry.metadata })

    // Store in destination tier
    if (toTier === 'warm') {
      await this.state.storage.put(`tiered:warm:${key}`, entry)
      this.warmKeys.add(key)
    } else if (toTier === 'cold') {
      await this.putToCold(key, entry)
      this.coldKeys.add(key)
    }

    // Remove from source tier
    if (fromTier === 'hot') {
      this.hotCache.delete(key)
    } else if (fromTier === 'warm') {
      await this.state.storage.delete(`tiered:warm:${key}`)
      this.warmKeys.delete(key)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // R2 COLD STORAGE METHODS
  // ═══════════════════════════════════════════════════════════════════════════

  private async putToCold<T>(key: string, entry: StoredEntry<T>): Promise<void> {
    if (!this.env.R2_COLD_STORAGE) {
      // Fallback to SQLite if R2 not available
      await this.state.storage.put(`tiered:cold:${key}`, entry)
      return
    }

    await this.env.R2_COLD_STORAGE.put(`tiered:cold:${key}`, JSON.stringify(entry))
  }

  private async getFromCold<T>(key: string): Promise<T | undefined> {
    if (!this.env.R2_COLD_STORAGE) {
      // Fallback to SQLite if R2 not available
      const stored = await this.state.storage.get<StoredEntry<T>>(`tiered:cold:${key}`)
      return stored?.value
    }

    const object = await this.env.R2_COLD_STORAGE.get(`tiered:cold:${key}`)
    if (!object) return undefined

    try {
      // R2 returns the body - we need to parse it
      // The value from json() might be a string (if stored as JSON.stringify) or already parsed
      const jsonResult = await object.json()
      let entry: StoredEntry<T>

      if (typeof jsonResult === 'string') {
        // Double-encoded: stored as JSON.stringify(entry), then json() returned the string
        entry = JSON.parse(jsonResult) as StoredEntry<T>
      } else {
        // Already parsed object
        entry = jsonResult as StoredEntry<T>
      }

      return entry.value
    } catch {
      return undefined
    }
  }

  private async deleteFromCold(key: string): Promise<void> {
    if (!this.env.R2_COLD_STORAGE) {
      // Fallback to SQLite if R2 not available
      await this.state.storage.delete(`tiered:cold:${key}`)
      return
    }

    await this.env.R2_COLD_STORAGE.delete(`tiered:cold:${key}`)
  }
}
