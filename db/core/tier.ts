/**
 * TierManager - Tiered data storage for the compat layer
 *
 * Handles data movement across storage tiers:
 * - Hot: SQLite in DO (fast, limited to ~10GB)
 * - Warm: R2 object storage (slower, larger)
 * - Cold: R2 Archive (cheapest, slowest)
 *
 * @example
 * ```typescript
 * const tier = new TierManager(
 *   { hot: sqliteStore, warm: r2Bucket, cold: r2Archive },
 *   { hotThreshold: '1GB', coldAfter: '90d' }
 * )
 *
 * // Tiered lookups
 * const data = await tier.get('user:1') // Checks hot → warm → cold
 *
 * // Automatic promotion/archival
 * if (tier.shouldPromoteToWarm()) {
 *   await tier.promoteToWarm('old-key')
 * }
 * ```
 */
import type { TierConfig } from './types'
import { DEFAULT_TIER_CONFIG } from './types'

// ============================================================================
// SIZE PARSING
// ============================================================================

const SIZE_UNITS: Record<string, number> = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
  TB: 1024 * 1024 * 1024 * 1024,
}

/**
 * Parse a size string (e.g., "1GB", "500MB") to bytes
 */
export function parseSize(size: string): number {
  const match = size.toUpperCase().match(/^(\d+(?:\.\d+)?)(KB|MB|GB|TB)$/)
  if (!match) {
    throw new Error(`Invalid size format: ${size}. Expected format: 1GB, 500MB, etc.`)
  }

  const value = parseFloat(match[1]!)
  const unit = match[2]! as keyof typeof SIZE_UNITS
  return value * SIZE_UNITS[unit]!
}

/**
 * Format bytes to a human-readable size string
 */
export function formatSize(bytes: number): string {
  if (bytes >= SIZE_UNITS.TB!) {
    return `${(bytes / SIZE_UNITS.TB!).toFixed(bytes % SIZE_UNITS.TB! === 0 ? 0 : 1)}TB`
  }
  if (bytes >= SIZE_UNITS.GB!) {
    return `${(bytes / SIZE_UNITS.GB!).toFixed(bytes % SIZE_UNITS.GB! === 0 ? 0 : 1)}GB`
  }
  if (bytes >= SIZE_UNITS.MB!) {
    return `${(bytes / SIZE_UNITS.MB!).toFixed(bytes % SIZE_UNITS.MB! === 0 ? 0 : 0)}MB`
  }
  return `${(bytes / SIZE_UNITS.KB!).toFixed(bytes % SIZE_UNITS.KB! === 0 ? 0 : 1)}KB`
}

// ============================================================================
// DURATION PARSING
// ============================================================================

const DURATION_UNITS: Record<string, number> = {
  S: 1000,
  M: 60 * 1000,
  H: 60 * 60 * 1000,
  D: 24 * 60 * 60 * 1000,
}

/**
 * Parse a duration string (e.g., "30d", "24h") to milliseconds
 */
export function parseDuration(duration: string): number {
  const match = duration.toUpperCase().match(/^(\d+)(S|M|H|D)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Expected format: 30d, 24h, 60m, etc.`)
  }

  const value = parseInt(match[1]!, 10)
  const unit = match[2]! as keyof typeof DURATION_UNITS
  return value * DURATION_UNITS[unit]!
}

/**
 * Format milliseconds to a human-readable duration string
 */
export function formatDuration(ms: number): string {
  if (ms >= DURATION_UNITS.D! && ms % DURATION_UNITS.D! === 0) {
    return `${ms / DURATION_UNITS.D!}d`
  }
  if (ms >= DURATION_UNITS.H! && ms % DURATION_UNITS.H! === 0) {
    return `${ms / DURATION_UNITS.H!}h`
  }
  if (ms >= DURATION_UNITS.M! && ms % DURATION_UNITS.M! === 0) {
    return `${ms / DURATION_UNITS.M!}m`
  }
  return `${ms / DURATION_UNITS.S!}s`
}

// ============================================================================
// STORAGE INTERFACES
// ============================================================================

/**
 * Hot tier storage interface (SQLite-like)
 */
export interface HotStorage {
  get(key: string): unknown
  put(key: string, value: unknown): void
  delete(key: string): void
  getSize(): number
}

/**
 * Warm/Cold tier storage interface (R2-like)
 */
export interface ColdStorage {
  get(key: string): Promise<{ body: { text(): Promise<string> } } | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<{ objects: Array<{ key: string }> }>
}

/**
 * Storage bindings for all tiers
 */
export interface TierBindings {
  hot: HotStorage
  warm: ColdStorage
  cold: ColdStorage
}

// ============================================================================
// TIER MANAGER CLASS
// ============================================================================

/**
 * TierManager - Manages tiered data storage
 */
export class TierManager {
  private bindings: TierBindings
  private _config: TierConfig

  constructor(bindings: TierBindings, config?: Partial<TierConfig>) {
    this.bindings = bindings
    this._config = {
      ...DEFAULT_TIER_CONFIG,
      ...config,
    }
  }

  /**
   * Get the tier configuration
   */
  get config(): TierConfig {
    return this._config
  }

  /**
   * Get current hot tier size in bytes
   */
  get hotSize(): number {
    return this.bindings.hot.getSize()
  }

  /**
   * Get hot tier threshold in bytes
   */
  get hotThreshold(): number {
    return parseSize(this._config.hotThreshold ?? '1GB')
  }

  /**
   * Get data from any tier (hot → warm → cold)
   *
   * @param key - The key to look up
   * @returns The data or undefined if not found
   */
  async get(key: string): Promise<unknown> {
    // Try hot tier first
    const hotData = this.bindings.hot.get(key)
    if (hotData !== undefined) {
      return hotData
    }

    // Try warm tier
    const warmResult = await this.bindings.warm.get(key)
    if (warmResult) {
      const text = await warmResult.body.text()
      return JSON.parse(text)
    }

    // Try cold tier
    const coldResult = await this.bindings.cold.get(key)
    if (coldResult) {
      const text = await coldResult.body.text()
      return JSON.parse(text)
    }

    return undefined
  }

  /**
   * Put data into hot tier
   *
   * @param key - The key
   * @param value - The data to store
   */
  async put(key: string, value: unknown): Promise<void> {
    this.bindings.hot.put(key, value)
  }

  /**
   * Delete data from all tiers
   *
   * @param key - The key to delete
   */
  async delete(key: string): Promise<void> {
    this.bindings.hot.delete(key)
    await this.bindings.warm.delete(key)
    await this.bindings.cold.delete(key)
  }

  /**
   * Check if hot tier should be promoted to warm
   */
  shouldPromoteToWarm(): boolean {
    return this.hotSize > this.hotThreshold
  }

  /**
   * Promote data from hot to warm tier
   *
   * @param key - The key to promote
   */
  async promoteToWarm(key: string): Promise<void> {
    const data = this.bindings.hot.get(key)
    if (data === undefined) {
      return
    }

    // Write to warm first
    await this.bindings.warm.put(key, JSON.stringify(data))

    // Only delete from hot if warm write succeeded
    this.bindings.hot.delete(key)
  }

  /**
   * Check if data should be archived to cold tier
   *
   * @param timestamp - The data's timestamp (ms since epoch)
   */
  shouldArchiveCold(timestamp: number): boolean {
    const coldAfterMs = parseDuration(this._config.coldAfter ?? '90d')
    const age = Date.now() - timestamp
    return age > coldAfterMs
  }

  /**
   * Archive data from warm to cold tier
   *
   * @param key - The key to archive
   */
  async archiveCold(key: string): Promise<void> {
    const warmResult = await this.bindings.warm.get(key)
    if (!warmResult) {
      return
    }

    const data = await warmResult.body.text()

    // Write to cold first
    await this.bindings.cold.put(key, data)

    // Only delete from warm if cold write succeeded
    await this.bindings.warm.delete(key)
  }

  /**
   * Restore data from cold to warm tier
   *
   * @param key - The key to restore
   */
  async restoreFromCold(key: string): Promise<void> {
    const coldResult = await this.bindings.cold.get(key)
    if (!coldResult) {
      return
    }

    const data = await coldResult.body.text()

    // Write to warm
    await this.bindings.warm.put(key, data)

    // Optionally delete from cold (or keep as backup)
    // await this.bindings.cold.delete(key)
  }
}
