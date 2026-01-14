/**
 * Tier Configuration - Production-Quality Implementation
 *
 * Comprehensive tier configuration for tiered storage supporting:
 * - Tier definitions (hot, warm, cold)
 * - Thresholds for tier selection (size boundaries)
 * - Tier enable/disable options (warmEnabled, coldEnabled)
 * - Promotion policies (rules for automatic tier promotion)
 * - Demotion policies (rules for automatic tier demotion)
 * - Configuration validation with detailed error messages
 * - Fluent builder API
 * - Serialization/deserialization
 * - Configuration presets (aggressive, balanced, conservative)
 * - Environment-based config overrides
 * - Config change observers with unsubscribe support
 *
 * @module storage/tier-config
 */

import type { StorageTier } from '../core/types'

// ===========================================================================
// Error Types
// ===========================================================================

/**
 * Error thrown when tier configuration is invalid.
 * Provides structured error information for debugging.
 *
 * @example
 * ```typescript
 * try {
 *   validateTierConfig({ thresholds: { hotMaxSize: -1 } })
 * } catch (e) {
 *   if (e instanceof TierConfigError) {
 *     console.log(`Field: ${e.field}, Reason: ${e.reason}`)
 *   }
 * }
 * ```
 */
export class TierConfigError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly reason?: string
  ) {
    super(message)
    this.name = 'TierConfigError'
  }
}

// ===========================================================================
// Type Definitions
// ===========================================================================

export interface TierThresholds {
  hotMaxSize?: number
  warmMaxSize?: number
}

export interface DemotionThresholds {
  hotMaxAgeDays?: number
  warmMaxAgeDays?: number
}

export interface PromotionThresholds {
  minAccessCount?: number
  maxAgeDays?: number
}

export type PromotionPolicy = 'none' | 'on-access' | 'aggressive'
export type DemotionPolicy = 'none' | 'on-age'

export interface TierConfigOptions {
  thresholds?: TierThresholds
  warmEnabled?: boolean
  coldEnabled?: boolean
  hotEnabled?: boolean
  promotionPolicy?: PromotionPolicy
  demotionPolicy?: DemotionPolicy
  promotionThresholds?: PromotionThresholds
  demotionThresholds?: DemotionThresholds
}

export interface TierInfo {
  name: StorageTier
  description: string
  storageType: string
}

export interface FileMetadata {
  tier: StorageTier
  accessCount?: number
  lastAccess?: number
  size: number
}

export interface ConfigChangeEvent {
  field: string
  oldValue: any
  newValue: any
}

// ===========================================================================
// Constants
// ===========================================================================

/** Default maximum file size for hot tier (1MB) */
const DEFAULT_HOT_MAX_SIZE = 1024 * 1024

/** Default maximum file size for warm tier (100MB) */
const DEFAULT_WARM_MAX_SIZE = 100 * 1024 * 1024

/** Default maximum age in hot tier before demotion (1 day) */
const DEFAULT_HOT_MAX_AGE_DAYS = 1

/** Default maximum age in warm tier before demotion (30 days) */
const DEFAULT_WARM_MAX_AGE_DAYS = 30

/** Default minimum access count for promotion */
const DEFAULT_MIN_ACCESS_COUNT = 1

/** Default maximum age for promotion eligibility (7 days) */
const DEFAULT_MAX_AGE_DAYS_FOR_PROMOTION = 7

/** Milliseconds per day constant for age calculations */
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Valid promotion policy values */
const VALID_PROMOTION_POLICIES: readonly PromotionPolicy[] = ['none', 'on-access', 'aggressive'] as const

/** Valid demotion policy values */
const VALID_DEMOTION_POLICIES: readonly DemotionPolicy[] = ['none', 'on-age'] as const

/** Tier metadata providing storage backend information */
const TIER_INFO: Readonly<Record<StorageTier, TierInfo>> = {
  hot: {
    name: 'hot',
    description: 'Durable Object SQLite storage - low latency, ideal for small files',
    storageType: 'durable-object',
  },
  warm: {
    name: 'warm',
    description: 'R2 object storage - balanced performance, suitable for large files',
    storageType: 'r2',
  },
  cold: {
    name: 'cold',
    description: 'Archive storage - lowest cost, for infrequently accessed data',
    storageType: 'r2-archive',
  },
} as const

/** Tier priorities (lower = higher priority/faster access) */
const TIER_PRIORITIES: Readonly<Record<StorageTier, number>> = {
  hot: 0,
  warm: 1,
  cold: 2,
} as const

// ===========================================================================
// Configuration Presets
// ===========================================================================

/**
 * Preset name for pre-configured tier settings
 */
export type TierConfigPreset = 'aggressive' | 'balanced' | 'conservative'

/**
 * Configuration presets for common use cases.
 *
 * - **aggressive**: Maximizes hot tier usage, promotes quickly, demotes slowly
 * - **balanced**: Default settings, suitable for most workloads
 * - **conservative**: Minimizes hot tier, promotes slowly, demotes quickly
 */
export const CONFIG_PRESETS: Readonly<Record<TierConfigPreset, TierConfigOptions>> = {
  /**
   * Aggressive preset: Maximize hot tier usage for lowest latency.
   * Best for: Applications with high read frequency and performance sensitivity.
   */
  aggressive: {
    thresholds: {
      hotMaxSize: 5 * 1024 * 1024,     // 5MB - larger hot tier
      warmMaxSize: 200 * 1024 * 1024,  // 200MB - larger warm tier
    },
    warmEnabled: true,
    coldEnabled: true,
    promotionPolicy: 'aggressive',
    demotionPolicy: 'on-age',
    promotionThresholds: {
      minAccessCount: 1,   // Promote immediately on first access
      maxAgeDays: 30,      // Allow older files to be promoted
    },
    demotionThresholds: {
      hotMaxAgeDays: 7,    // Keep in hot tier longer
      warmMaxAgeDays: 90,  // Keep in warm tier longer
    },
  },

  /**
   * Balanced preset: Default settings suitable for most workloads.
   * Best for: General-purpose applications with mixed access patterns.
   */
  balanced: {
    thresholds: {
      hotMaxSize: DEFAULT_HOT_MAX_SIZE,
      warmMaxSize: DEFAULT_WARM_MAX_SIZE,
    },
    warmEnabled: true,
    coldEnabled: true,
    promotionPolicy: 'on-access',
    demotionPolicy: 'on-age',
    promotionThresholds: {
      minAccessCount: DEFAULT_MIN_ACCESS_COUNT,
      maxAgeDays: DEFAULT_MAX_AGE_DAYS_FOR_PROMOTION,
    },
    demotionThresholds: {
      hotMaxAgeDays: DEFAULT_HOT_MAX_AGE_DAYS,
      warmMaxAgeDays: DEFAULT_WARM_MAX_AGE_DAYS,
    },
  },

  /**
   * Conservative preset: Minimize hot tier usage to reduce costs.
   * Best for: Cost-sensitive applications with archival/backup workloads.
   */
  conservative: {
    thresholds: {
      hotMaxSize: 256 * 1024,          // 256KB - smaller hot tier
      warmMaxSize: 50 * 1024 * 1024,   // 50MB - smaller warm tier
    },
    warmEnabled: true,
    coldEnabled: true,
    promotionPolicy: 'none',           // No automatic promotion
    demotionPolicy: 'on-age',
    promotionThresholds: {
      minAccessCount: 10,  // High threshold if manually promoting
      maxAgeDays: 1,       // Only promote very recent files
    },
    demotionThresholds: {
      hotMaxAgeDays: 1,    // Quick demotion from hot
      warmMaxAgeDays: 7,   // Quick demotion from warm
    },
  },
} as const

// ===========================================================================
// TierConfig Class
// ===========================================================================

/** Event handler function type for config changes */
type ConfigChangeHandler = (event: ConfigChangeEvent) => void

/**
 * Tier Configuration - manages tiered storage settings.
 *
 * Provides a comprehensive API for configuring tiered storage behavior including:
 * - Tier size thresholds for automatic placement
 * - Promotion and demotion policies
 * - Runtime configuration updates with change notification
 * - Serialization for persistence
 *
 * @example
 * ```typescript
 * // Create with defaults
 * const config = new TierConfig()
 *
 * // Create with custom options
 * const config = new TierConfig({
 *   thresholds: { hotMaxSize: 512 * 1024 },
 *   promotionPolicy: 'aggressive'
 * })
 *
 * // Create from preset
 * const config = TierConfig.fromPreset('conservative')
 * ```
 */
export class TierConfig {
  private _thresholds: Required<TierThresholds>
  private _warmEnabled: boolean
  private _coldEnabled: boolean
  private _promotionPolicy: PromotionPolicy
  private _demotionPolicy: DemotionPolicy
  private _promotionThresholds: Required<PromotionThresholds>
  private _demotionThresholds: Required<DemotionThresholds>
  private _eventHandlers: Map<string, ConfigChangeHandler[]>
  private _immutable: boolean
  /** Cached list of available tiers, invalidated on tier enable/disable */
  private _cachedAvailableTiers: StorageTier[] | null = null

  constructor(options?: TierConfigOptions) {
    // Validate options
    if (options) {
      validateTierConfig(options)
    }

    // Check for hotEnabled: false explicitly
    if (options && (options as any).hotEnabled === false) {
      throw new TierConfigError('Hot tier cannot be disabled', 'hotEnabled', 'Hot tier must always be enabled')
    }

    // Initialize with defaults, then override with options
    this._thresholds = {
      hotMaxSize: options?.thresholds?.hotMaxSize ?? DEFAULT_HOT_MAX_SIZE,
      warmMaxSize: options?.thresholds?.warmMaxSize ?? DEFAULT_WARM_MAX_SIZE,
    }

    this._warmEnabled = options?.warmEnabled ?? true
    this._coldEnabled = options?.coldEnabled ?? true
    this._promotionPolicy = options?.promotionPolicy ?? 'on-access'
    this._demotionPolicy = options?.demotionPolicy ?? 'on-age'

    this._promotionThresholds = {
      minAccessCount: options?.promotionThresholds?.minAccessCount ?? DEFAULT_MIN_ACCESS_COUNT,
      maxAgeDays: options?.promotionThresholds?.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS_FOR_PROMOTION,
    }

    this._demotionThresholds = {
      hotMaxAgeDays: options?.demotionThresholds?.hotMaxAgeDays ?? DEFAULT_HOT_MAX_AGE_DAYS,
      warmMaxAgeDays: options?.demotionThresholds?.warmMaxAgeDays ?? DEFAULT_WARM_MAX_AGE_DAYS,
    }

    this._eventHandlers = new Map()
    this._immutable = false
  }

  // ---------------------------------------------------------------------------
  // Static Factory Methods
  // ---------------------------------------------------------------------------

  /**
   * Create a TierConfig from a named preset.
   *
   * @param preset - The preset name ('aggressive', 'balanced', 'conservative')
   * @returns A new TierConfig instance with preset values
   *
   * @example
   * ```typescript
   * const config = TierConfig.fromPreset('aggressive')
   * ```
   */
  static fromPreset(preset: TierConfigPreset): TierConfig {
    const options = CONFIG_PRESETS[preset]
    return new TierConfig(options)
  }

  /**
   * Create a TierConfig from environment variables.
   * Reads FSX_* prefixed environment variables if available.
   *
   * Supported environment variables:
   * - FSX_HOT_MAX_SIZE: Maximum size for hot tier (bytes)
   * - FSX_WARM_MAX_SIZE: Maximum size for warm tier (bytes)
   * - FSX_WARM_ENABLED: Enable warm tier ('true'/'false')
   * - FSX_COLD_ENABLED: Enable cold tier ('true'/'false')
   * - FSX_PROMOTION_POLICY: Promotion policy ('none'/'on-access'/'aggressive')
   * - FSX_DEMOTION_POLICY: Demotion policy ('none'/'on-age')
   *
   * @param env - Environment object (defaults to process.env in Node.js)
   * @param baseOptions - Base options to merge with env overrides
   * @returns A new TierConfig instance
   */
  static fromEnvironment(
    env: Record<string, string | undefined> = {},
    baseOptions?: TierConfigOptions
  ): TierConfig {
    const options: TierConfigOptions = { ...baseOptions }

    // Parse threshold overrides
    const hotMaxSize = parseEnvNumber(env.FSX_HOT_MAX_SIZE)
    const warmMaxSize = parseEnvNumber(env.FSX_WARM_MAX_SIZE)
    if (hotMaxSize !== undefined || warmMaxSize !== undefined) {
      options.thresholds = {
        ...options.thresholds,
        ...(hotMaxSize !== undefined && { hotMaxSize }),
        ...(warmMaxSize !== undefined && { warmMaxSize }),
      }
    }

    // Parse tier enable/disable
    const warmEnabled = parseEnvBoolean(env.FSX_WARM_ENABLED)
    const coldEnabled = parseEnvBoolean(env.FSX_COLD_ENABLED)
    if (warmEnabled !== undefined) options.warmEnabled = warmEnabled
    if (coldEnabled !== undefined) options.coldEnabled = coldEnabled

    // Parse policies
    const promotionPolicy = parseEnvPromotionPolicy(env.FSX_PROMOTION_POLICY)
    const demotionPolicy = parseEnvDemotionPolicy(env.FSX_DEMOTION_POLICY)
    if (promotionPolicy !== undefined) options.promotionPolicy = promotionPolicy
    if (demotionPolicy !== undefined) options.demotionPolicy = demotionPolicy

    return new TierConfig(options)
  }

  // ---------------------------------------------------------------------------
  // Tier Definitions
  // ---------------------------------------------------------------------------

  /**
   * Get the list of currently enabled tiers.
   * Result is cached and invalidated when tiers are enabled/disabled.
   */
  getAvailableTiers(): StorageTier[] {
    if (this._cachedAvailableTiers === null) {
      const tiers: StorageTier[] = ['hot']
      if (this._warmEnabled) tiers.push('warm')
      if (this._coldEnabled) tiers.push('cold')
      this._cachedAvailableTiers = tiers
    }
    return [...this._cachedAvailableTiers]
  }

  getDefaultTier(): StorageTier {
    return 'hot'
  }

  isTierEnabled(tier: StorageTier): boolean {
    switch (tier) {
      case 'hot':
        return true // Always enabled
      case 'warm':
        return this._warmEnabled
      case 'cold':
        return this._coldEnabled
    }
  }

  getTierPriorities(): Record<StorageTier, number> {
    return { ...TIER_PRIORITIES }
  }

  getTierInfo(tier: StorageTier): TierInfo {
    return { ...TIER_INFO[tier] }
  }

  // ---------------------------------------------------------------------------
  // Threshold Configuration
  // ---------------------------------------------------------------------------

  getThresholds(): Required<TierThresholds> {
    return { ...this._thresholds }
  }

  selectTierForSize(size: number): StorageTier {
    // Always check hot first (always enabled)
    if (size <= this._thresholds.hotMaxSize) {
      return 'hot'
    }

    // Check warm tier if enabled and size fits
    if (this._warmEnabled && size <= this._thresholds.warmMaxSize) {
      return 'warm'
    }

    // If warm is disabled but size would fit in warm, fall back to hot
    if (!this._warmEnabled && size <= this._thresholds.warmMaxSize) {
      return 'hot'
    }

    // Check cold tier if enabled (file is larger than warm threshold)
    if (this._coldEnabled) {
      return 'cold'
    }

    // Fall back to warm if cold disabled but warm enabled
    if (this._warmEnabled) {
      return 'warm'
    }

    // Fall back to hot if both warm and cold disabled
    return 'hot'
  }

  // ---------------------------------------------------------------------------
  // Promotion Policy
  // ---------------------------------------------------------------------------

  getPromotionPolicy(): PromotionPolicy {
    return this._promotionPolicy
  }

  getPromotionThresholds(): PromotionThresholds {
    return { ...this._promotionThresholds }
  }

  shouldPromote(metadata: FileMetadata): boolean {
    // Can't promote if already at hot tier
    if (metadata.tier === 'hot') {
      return false
    }

    // Never promote if policy is none
    if (this._promotionPolicy === 'none') {
      return false
    }

    // Determine target tier
    const targetTier = this.getPromotionTarget(metadata.tier)
    if (!targetTier) {
      return false
    }

    // Check if file size fits in target tier
    const targetMaxSize =
      targetTier === 'hot' ? this._thresholds.hotMaxSize : this._thresholds.warmMaxSize
    if (metadata.size > targetMaxSize) {
      return false
    }

    // For aggressive policy, always promote if size fits
    if (this._promotionPolicy === 'aggressive') {
      return true
    }

    // For on-access policy, check thresholds
    if (this._promotionPolicy === 'on-access') {
      const accessCount = metadata.accessCount ?? 0
      const lastAccess = metadata.lastAccess ?? 0

      // Check minimum access count
      if (accessCount < this._promotionThresholds.minAccessCount) {
        return false
      }

      // Check max age for promotion (file must be recently accessed)
      const maxAgeMs = this._promotionThresholds.maxAgeDays * MS_PER_DAY
      const age = Date.now() - lastAccess
      if (age > maxAgeMs) {
        return false
      }

      return true
    }

    // Exhaustive check - should never reach here
    return assertNever(this._promotionPolicy)
  }

  getPromotionTarget(tier: StorageTier): StorageTier | null {
    switch (tier) {
      case 'hot':
        return null // Already at highest tier
      case 'warm':
        return 'hot'
      case 'cold':
        // Skip to hot if warm is disabled
        return this._warmEnabled ? 'warm' : 'hot'
    }
  }

  // ---------------------------------------------------------------------------
  // Demotion Policy
  // ---------------------------------------------------------------------------

  isDemotionEnabled(): boolean {
    return this._demotionPolicy !== 'none'
  }

  getDemotionThresholds(): Required<DemotionThresholds> {
    return { ...this._demotionThresholds }
  }

  shouldDemote(metadata: FileMetadata): boolean {
    // Can't demote if already at cold tier
    if (metadata.tier === 'cold') {
      return false
    }

    // Never demote if policy is none
    if (this._demotionPolicy === 'none') {
      return false
    }

    // Check if there's a valid demotion target
    const targetTier = this.getDemotionTarget(metadata.tier)
    if (!targetTier) {
      return false
    }

    // Check age thresholds
    const lastAccess = metadata.lastAccess ?? Date.now()
    const ageMs = Date.now() - lastAccess
    const ageDays = ageMs / MS_PER_DAY

    // At this point, tier can only be 'hot' or 'warm' (cold handled above)
    if (metadata.tier === 'hot') {
      return ageDays > this._demotionThresholds.hotMaxAgeDays
    }

    // metadata.tier === 'warm'
    return ageDays > this._demotionThresholds.warmMaxAgeDays
  }

  getDemotionTarget(tier: StorageTier): StorageTier | null {
    switch (tier) {
      case 'cold':
        return null // Already at lowest tier
      case 'warm':
        // Can't demote to cold if cold is disabled
        return this._coldEnabled ? 'cold' : null
      case 'hot':
        // Skip to cold if warm is disabled (and cold is enabled)
        if (!this._warmEnabled) {
          return this._coldEnabled ? 'cold' : null
        }
        return 'warm'
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime Updates
  // ---------------------------------------------------------------------------

  updateThresholds(thresholds: Partial<TierThresholds>): void {
    this._checkMutable()

    // Validate new thresholds
    const newThresholds = {
      hotMaxSize: thresholds.hotMaxSize ?? this._thresholds.hotMaxSize,
      warmMaxSize: thresholds.warmMaxSize ?? this._thresholds.warmMaxSize,
    }

    validateThresholds(newThresholds)

    // Apply updates with events
    if (thresholds.hotMaxSize !== undefined && thresholds.hotMaxSize !== this._thresholds.hotMaxSize) {
      this._emitChange('thresholds.hotMaxSize', this._thresholds.hotMaxSize, thresholds.hotMaxSize)
      this._thresholds.hotMaxSize = thresholds.hotMaxSize
    }

    if (thresholds.warmMaxSize !== undefined && thresholds.warmMaxSize !== this._thresholds.warmMaxSize) {
      this._emitChange('thresholds.warmMaxSize', this._thresholds.warmMaxSize, thresholds.warmMaxSize)
      this._thresholds.warmMaxSize = thresholds.warmMaxSize
    }
  }

  setTierEnabled(tier: StorageTier, enabled: boolean): void {
    this._checkMutable()

    switch (tier) {
      case 'hot':
        if (!enabled) {
          throw new TierConfigError('Hot tier cannot be disabled', 'hotEnabled', 'Hot tier must always be enabled')
        }
        // Hot tier is always enabled, no change needed
        break
      case 'warm': {
        const oldValue = this._warmEnabled
        if (oldValue !== enabled) {
          this._warmEnabled = enabled
          this._invalidateTierCache()
          this._emitChange('warmEnabled', oldValue, enabled)
        }
        break
      }
      case 'cold': {
        const oldValue = this._coldEnabled
        if (oldValue !== enabled) {
          this._coldEnabled = enabled
          this._invalidateTierCache()
          this._emitChange('coldEnabled', oldValue, enabled)
        }
        break
      }
    }
  }

  /** Invalidate the cached tier list */
  private _invalidateTierCache(): void {
    this._cachedAvailableTiers = null
  }

  setPromotionPolicy(policy: PromotionPolicy): void {
    this._checkMutable()

    const oldValue = this._promotionPolicy
    this._promotionPolicy = policy
    this._emitChange('promotionPolicy', oldValue, policy)
  }

  updateDemotionThresholds(thresholds: Partial<DemotionThresholds>): void {
    this._checkMutable()

    if (thresholds.hotMaxAgeDays !== undefined) {
      if (thresholds.hotMaxAgeDays < 0) {
        throw new TierConfigError('Demotion threshold cannot be negative', 'demotionThresholds.hotMaxAgeDays', 'Value must be non-negative')
      }
      const oldValue = this._demotionThresholds.hotMaxAgeDays
      this._demotionThresholds.hotMaxAgeDays = thresholds.hotMaxAgeDays
      this._emitChange('demotionThresholds.hotMaxAgeDays', oldValue, thresholds.hotMaxAgeDays)
    }

    if (thresholds.warmMaxAgeDays !== undefined) {
      if (thresholds.warmMaxAgeDays < 0) {
        throw new TierConfigError('Demotion threshold cannot be negative', 'demotionThresholds.warmMaxAgeDays', 'Value must be non-negative')
      }
      const oldValue = this._demotionThresholds.warmMaxAgeDays
      this._demotionThresholds.warmMaxAgeDays = thresholds.warmMaxAgeDays
      this._emitChange('demotionThresholds.warmMaxAgeDays', oldValue, thresholds.warmMaxAgeDays)
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to configuration change events.
   *
   * @param event - The event type (currently only 'configChange')
   * @param handler - Callback function invoked on changes
   * @returns Unsubscribe function to remove the handler
   *
   * @example
   * ```typescript
   * const unsubscribe = config.on('configChange', (event) => {
   *   console.log(`${event.field} changed from ${event.oldValue} to ${event.newValue}`)
   * })
   *
   * // Later: unsubscribe
   * unsubscribe()
   * ```
   */
  on(event: 'configChange', handler: ConfigChangeHandler): () => void {
    const handlers = this._eventHandlers.get(event) ?? []
    handlers.push(handler)
    this._eventHandlers.set(event, handlers)

    // Return unsubscribe function
    return () => this.off(event, handler)
  }

  /**
   * Unsubscribe from configuration change events.
   *
   * @param event - The event type
   * @param handler - The handler function to remove
   * @returns true if handler was removed, false if not found
   */
  off(event: 'configChange', handler: ConfigChangeHandler): boolean {
    const handlers = this._eventHandlers.get(event)
    if (!handlers) return false

    const index = handlers.indexOf(handler)
    if (index === -1) return false

    handlers.splice(index, 1)
    return true
  }

  private _emitChange(field: string, oldValue: unknown, newValue: unknown): void {
    const handlers = this._eventHandlers.get('configChange') ?? []
    const event: ConfigChangeEvent = { field, oldValue, newValue }
    for (const handler of handlers) {
      handler(event)
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot/Restore
  // ---------------------------------------------------------------------------

  snapshot(): TierConfigOptions {
    return {
      thresholds: { ...this._thresholds },
      warmEnabled: this._warmEnabled,
      coldEnabled: this._coldEnabled,
      promotionPolicy: this._promotionPolicy,
      demotionPolicy: this._demotionPolicy,
      promotionThresholds: { ...this._promotionThresholds },
      demotionThresholds: { ...this._demotionThresholds },
    }
  }

  restore(snapshot: TierConfigOptions): void {
    this._checkMutable()

    if (snapshot.thresholds) {
      this._thresholds = {
        hotMaxSize: snapshot.thresholds.hotMaxSize ?? DEFAULT_HOT_MAX_SIZE,
        warmMaxSize: snapshot.thresholds.warmMaxSize ?? DEFAULT_WARM_MAX_SIZE,
      }
    }

    if (snapshot.warmEnabled !== undefined) {
      this._warmEnabled = snapshot.warmEnabled
    }

    if (snapshot.coldEnabled !== undefined) {
      this._coldEnabled = snapshot.coldEnabled
    }

    if (snapshot.promotionPolicy !== undefined) {
      this._promotionPolicy = snapshot.promotionPolicy
    }

    if (snapshot.demotionPolicy !== undefined) {
      this._demotionPolicy = snapshot.demotionPolicy
    }

    if (snapshot.promotionThresholds) {
      this._promotionThresholds = {
        minAccessCount: snapshot.promotionThresholds.minAccessCount ?? DEFAULT_MIN_ACCESS_COUNT,
        maxAgeDays: snapshot.promotionThresholds.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS_FOR_PROMOTION,
      }
    }

    if (snapshot.demotionThresholds) {
      this._demotionThresholds = {
        hotMaxAgeDays: snapshot.demotionThresholds.hotMaxAgeDays ?? DEFAULT_HOT_MAX_AGE_DAYS,
        warmMaxAgeDays: snapshot.demotionThresholds.warmMaxAgeDays ?? DEFAULT_WARM_MAX_AGE_DAYS,
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toJSON(): string {
    return JSON.stringify(this.toObject())
  }

  static fromJSON(json: string): TierConfig {
    const parsed = JSON.parse(json)
    validateTierConfig(parsed)
    return new TierConfig(parsed)
  }

  toObject(): TierConfigOptions {
    return {
      thresholds: { ...this._thresholds },
      warmEnabled: this._warmEnabled,
      coldEnabled: this._coldEnabled,
      promotionPolicy: this._promotionPolicy,
      demotionPolicy: this._demotionPolicy,
      promotionThresholds: { ...this._promotionThresholds },
      demotionThresholds: { ...this._demotionThresholds },
    }
  }

  // ---------------------------------------------------------------------------
  // Integration
  // ---------------------------------------------------------------------------

  toTieredFSConfig(): any {
    return {
      thresholds: { ...this._thresholds },
      warmEnabled: this._warmEnabled,
      coldEnabled: this._coldEnabled,
      promotionPolicy: this._promotionPolicy,
      demotionPolicy: this._demotionPolicy,
    }
  }

  toTieredR2Config(): any {
    return {
      policy: {
        hotMaxAgeDays: this._demotionThresholds.hotMaxAgeDays,
        warmMaxAgeDays: this._demotionThresholds.warmMaxAgeDays,
      },
    }
  }

  // ---------------------------------------------------------------------------
  // Mutability
  // ---------------------------------------------------------------------------

  /** @internal */
  _setImmutable(immutable: boolean): void {
    this._immutable = immutable
  }

  private _checkMutable(): void {
    if (this._immutable) {
      throw new TierConfigError('Configuration is immutable', 'immutable', 'Cannot modify immutable configuration')
    }
  }
}

// ===========================================================================
// TierConfigBuilder Class
// ===========================================================================

/**
 * Fluent builder for TierConfig
 */
export class TierConfigBuilder {
  private _options: TierConfigOptions = {}
  private _mutable: boolean = false

  withHotMaxSize(size: number): this {
    this._options.thresholds = this._options.thresholds ?? {}
    this._options.thresholds.hotMaxSize = size
    return this
  }

  withWarmMaxSize(size: number): this {
    this._options.thresholds = this._options.thresholds ?? {}
    this._options.thresholds.warmMaxSize = size
    return this
  }

  withPromotionPolicy(policy: PromotionPolicy): this {
    this._options.promotionPolicy = policy
    return this
  }

  withDemotionPolicy(policy: DemotionPolicy): this {
    this._options.demotionPolicy = policy
    return this
  }

  disableWarmTier(): this {
    this._options.warmEnabled = false
    return this
  }

  disableColdTier(): this {
    this._options.coldEnabled = false
    return this
  }

  withMinAccessCount(count: number): this {
    this._options.promotionThresholds = this._options.promotionThresholds ?? {}
    this._options.promotionThresholds.minAccessCount = count
    return this
  }

  withMaxAgeDaysForPromotion(days: number): this {
    this._options.promotionThresholds = this._options.promotionThresholds ?? {}
    this._options.promotionThresholds.maxAgeDays = days
    return this
  }

  withHotMaxAgeDays(days: number): this {
    this._options.demotionThresholds = this._options.demotionThresholds ?? {}
    this._options.demotionThresholds.hotMaxAgeDays = days
    return this
  }

  withWarmMaxAgeDays(days: number): this {
    this._options.demotionThresholds = this._options.demotionThresholds ?? {}
    this._options.demotionThresholds.warmMaxAgeDays = days
    return this
  }

  mutable(): this {
    this._mutable = true
    return this
  }

  build(): TierConfig {
    // Validate before building
    validateTierConfig(this._options)

    const config = new TierConfig(this._options)
    if (!this._mutable) {
      config._setImmutable(true)
    }
    return config
  }
}

// ===========================================================================
// TierConfigValidator Class
// ===========================================================================

/**
 * Validator for tier configuration
 */
export class TierConfigValidator {
  static validate(config: TierConfigOptions): void {
    validateTierConfig(config)
  }
}

// ===========================================================================
// Utility Functions
// ===========================================================================

/**
 * Create a default tier configuration
 */
export function createDefaultTierConfig(): TierConfigOptions {
  return {
    thresholds: {
      hotMaxSize: DEFAULT_HOT_MAX_SIZE,
      warmMaxSize: DEFAULT_WARM_MAX_SIZE,
    },
    warmEnabled: true,
    coldEnabled: true,
    promotionPolicy: 'on-access',
    demotionPolicy: 'on-age',
    promotionThresholds: {
      minAccessCount: DEFAULT_MIN_ACCESS_COUNT,
      maxAgeDays: DEFAULT_MAX_AGE_DAYS_FOR_PROMOTION,
    },
    demotionThresholds: {
      hotMaxAgeDays: DEFAULT_HOT_MAX_AGE_DAYS,
      warmMaxAgeDays: DEFAULT_WARM_MAX_AGE_DAYS,
    },
  }
}

/**
 * Validate threshold values
 */
function validateThresholds(thresholds: TierThresholds): void {
  if (thresholds.hotMaxSize !== undefined) {
    if (typeof thresholds.hotMaxSize !== 'number') {
      throw new TierConfigError(
        'Invalid hotMaxSize type',
        'thresholds.hotMaxSize',
        'Must be a number'
      )
    }
    if (thresholds.hotMaxSize < 0) {
      throw new TierConfigError(
        'Threshold cannot be negative',
        'thresholds.hotMaxSize',
        'Value must be non-negative'
      )
    }
  }

  if (thresholds.warmMaxSize !== undefined) {
    if (typeof thresholds.warmMaxSize !== 'number') {
      throw new TierConfigError(
        'Invalid warmMaxSize type',
        'thresholds.warmMaxSize',
        'Must be a number'
      )
    }
    if (thresholds.warmMaxSize < 0) {
      throw new TierConfigError(
        'Threshold cannot be negative',
        'thresholds.warmMaxSize',
        'Value must be non-negative'
      )
    }
  }

  // Check ordering: hotMaxSize <= warmMaxSize
  const hotMax = thresholds.hotMaxSize ?? DEFAULT_HOT_MAX_SIZE
  const warmMax = thresholds.warmMaxSize ?? DEFAULT_WARM_MAX_SIZE
  if (hotMax > warmMax && !Number.isFinite(hotMax)) {
    // Infinity is allowed
    return
  }
  if (hotMax > warmMax && warmMax !== hotMax) {
    throw new TierConfigError(
      'Invalid threshold ordering',
      'thresholds',
      'hotMaxSize must be less than or equal to warmMaxSize'
    )
  }
}

/**
 * Validate a tier configuration.
 * Throws TierConfigError if any validation fails.
 *
 * @param config - The configuration object to validate
 * @throws {TierConfigError} If any field is invalid
 */
export function validateTierConfig(config: TierConfigOptions): void {
  // Validate thresholds
  if (config.thresholds) {
    validateThresholds(config.thresholds)
  }

  // Validate promotion policy
  if (config.promotionPolicy !== undefined) {
    if (!VALID_PROMOTION_POLICIES.includes(config.promotionPolicy)) {
      throw new TierConfigError(
        'Invalid promotion policy',
        'promotionPolicy',
        `Must be one of: ${VALID_PROMOTION_POLICIES.join(', ')}`
      )
    }
  }

  // Validate demotion policy
  if (config.demotionPolicy !== undefined) {
    if (!VALID_DEMOTION_POLICIES.includes(config.demotionPolicy)) {
      throw new TierConfigError(
        'Invalid demotion policy',
        'demotionPolicy',
        `Must be one of: ${VALID_DEMOTION_POLICIES.join(', ')}`
      )
    }
  }

  // Validate demotion thresholds
  if (config.demotionThresholds) {
    validateNonNegativeNumber(
      config.demotionThresholds.hotMaxAgeDays,
      'demotionThresholds.hotMaxAgeDays'
    )
    validateNonNegativeNumber(
      config.demotionThresholds.warmMaxAgeDays,
      'demotionThresholds.warmMaxAgeDays'
    )
  }

  // Validate promotion thresholds
  if (config.promotionThresholds) {
    validateNonNegativeNumber(
      config.promotionThresholds.minAccessCount,
      'promotionThresholds.minAccessCount'
    )
    validateNonNegativeNumber(
      config.promotionThresholds.maxAgeDays,
      'promotionThresholds.maxAgeDays'
    )
  }
}

/**
 * Merge two tier configurations with deep merging of nested objects.
 *
 * @param base - The base configuration
 * @param override - Values to override (partial configuration)
 * @returns A new merged configuration object
 *
 * @example
 * ```typescript
 * const merged = mergeTierConfigs(
 *   createDefaultTierConfig(),
 *   { thresholds: { hotMaxSize: 512 * 1024 } }
 * )
 * ```
 */
export function mergeTierConfigs(
  base: TierConfigOptions,
  override: Partial<TierConfigOptions>
): TierConfigOptions {
  const result: TierConfigOptions = {
    ...base,
    ...override,
  }

  // Deep merge thresholds
  if (base.thresholds || override.thresholds) {
    result.thresholds = {
      ...base.thresholds,
      ...override.thresholds,
    }
  }

  // Deep merge promotion thresholds
  if (base.promotionThresholds || override.promotionThresholds) {
    result.promotionThresholds = {
      ...base.promotionThresholds,
      ...override.promotionThresholds,
    }
  }

  // Deep merge demotion thresholds
  if (base.demotionThresholds || override.demotionThresholds) {
    result.demotionThresholds = {
      ...base.demotionThresholds,
      ...override.demotionThresholds,
    }
  }

  return result
}

// ===========================================================================
// Internal Helper Functions
// ===========================================================================

/**
 * Validate that a value is a non-negative number.
 * @internal
 */
function validateNonNegativeNumber(
  value: unknown,
  fieldName: string
): void {
  if (value === undefined) return

  if (typeof value !== 'number') {
    throw new TierConfigError(
      `Invalid ${fieldName} type`,
      fieldName,
      'Must be a number'
    )
  }

  if (value < 0) {
    throw new TierConfigError(
      `Invalid ${fieldName}`,
      fieldName,
      'Must be a non-negative number'
    )
  }
}

/**
 * Parse an environment variable as a number.
 * Returns undefined if the value is not set or not a valid number.
 * @internal
 */
function parseEnvNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

/**
 * Parse an environment variable as a boolean.
 * Returns undefined if the value is not set or not a valid boolean string.
 * @internal
 */
function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined
  const lower = value.toLowerCase()
  if (lower === 'true' || lower === '1' || lower === 'yes') return true
  if (lower === 'false' || lower === '0' || lower === 'no') return false
  return undefined
}

/**
 * Parse an environment variable as a promotion policy.
 * Returns undefined if the value is not set or not a valid policy.
 * @internal
 */
function parseEnvPromotionPolicy(value: string | undefined): PromotionPolicy | undefined {
  if (value === undefined || value === '') return undefined
  if (VALID_PROMOTION_POLICIES.includes(value as PromotionPolicy)) {
    return value as PromotionPolicy
  }
  return undefined
}

/**
 * Parse an environment variable as a demotion policy.
 * Returns undefined if the value is not set or not a valid policy.
 * @internal
 */
function parseEnvDemotionPolicy(value: string | undefined): DemotionPolicy | undefined {
  if (value === undefined || value === '') return undefined
  if (VALID_DEMOTION_POLICIES.includes(value as DemotionPolicy)) {
    return value as DemotionPolicy
  }
  return undefined
}

/**
 * Type assertion helper for exhaustive switch statements.
 * If this function is reached at runtime, it means a case was not handled.
 * @internal
 */
function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value}`)
}
