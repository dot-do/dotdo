/**
 * Three-tier storage types
 *
 * Defines types for hot/warm/cold data tiering:
 * - StorageTier: 'hot' | 'warm' | 'cold'
 * - TieringPolicy: Rules for when to tier data
 * - TierMetadata: Tracking info for tier decisions
 */

// ============================================================================
// STORAGE TIER
// ============================================================================

/**
 * Storage tier levels
 * - hot: DO SQLite, <1ms access, ~100MB limit
 * - warm: R2 Parquet, ~50ms access, ~10GB limit
 * - cold: R2 Iceberg Archive, ~100ms access, unlimited
 */
export type StorageTier = 'hot' | 'warm' | 'cold'

/**
 * All valid storage tiers
 */
export const STORAGE_TIERS: readonly StorageTier[] = ['hot', 'warm', 'cold'] as const

/**
 * Check if a value is a valid storage tier
 */
export function isStorageTier(value: unknown): value is StorageTier {
  return typeof value === 'string' && STORAGE_TIERS.includes(value as StorageTier)
}

// ============================================================================
// TIERING POLICY
// ============================================================================

/**
 * Policy for automatic data tiering
 *
 * Supports both age-based and access-based tiering:
 * - Age-based: Move data after a certain time period
 * - Access-based: Move data based on access patterns
 *
 * @example Age-based tiering (move to warm after 7 days, cold after 30 days)
 * ```typescript
 * const policy: TieringPolicy = {
 *   warmAfterMs: 7 * 24 * 60 * 60 * 1000,   // 7 days
 *   coldAfterMs: 30 * 24 * 60 * 60 * 1000,  // 30 days
 * }
 * ```
 *
 * @example Access-based tiering (move to warm after 100 accesses)
 * ```typescript
 * const policy: TieringPolicy = {
 *   warmAfterAccess: 100,
 *   coldAfterAccess: 1000,
 * }
 * ```
 *
 * @example Combined policy
 * ```typescript
 * const policy: TieringPolicy = {
 *   warmAfterMs: 7 * 24 * 60 * 60 * 1000,
 *   coldAfterMs: 30 * 24 * 60 * 60 * 1000,
 *   warmAfterAccess: 100,  // Also tier if accessed 100+ times
 * }
 * ```
 */
export interface TieringPolicy {
  /** Move to warm tier after this age in milliseconds */
  warmAfterMs?: number
  /** Move to cold tier after this age in milliseconds */
  coldAfterMs?: number
  /** Move to warm tier after N accesses (high-read data) */
  warmAfterAccess?: number
  /** Move to cold tier after N accesses (archival threshold) */
  coldAfterAccess?: number
  /** Custom predicate for warm tiering */
  shouldWarm?: (metadata: TierMetadata) => boolean
  /** Custom predicate for cold tiering */
  shouldCold?: (metadata: TierMetadata) => boolean
}

/**
 * Default tiering policy
 * - Warm after 7 days
 * - Cold after 90 days
 */
export const DEFAULT_TIERING_POLICY: Required<Pick<TieringPolicy, 'warmAfterMs' | 'coldAfterMs'>> = {
  warmAfterMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  coldAfterMs: 90 * 24 * 60 * 60 * 1000, // 90 days
}

/**
 * Validate tiering policy
 */
export function isValidTieringPolicy(policy: unknown): policy is TieringPolicy {
  if (!policy || typeof policy !== 'object') return false
  const p = policy as Record<string, unknown>

  // All numeric fields must be positive if provided
  if (p.warmAfterMs !== undefined && (typeof p.warmAfterMs !== 'number' || p.warmAfterMs <= 0)) return false
  if (p.coldAfterMs !== undefined && (typeof p.coldAfterMs !== 'number' || p.coldAfterMs <= 0)) return false
  if (p.warmAfterAccess !== undefined && (typeof p.warmAfterAccess !== 'number' || p.warmAfterAccess <= 0))
    return false
  if (p.coldAfterAccess !== undefined && (typeof p.coldAfterAccess !== 'number' || p.coldAfterAccess <= 0))
    return false

  // Custom predicates must be functions if provided
  if (p.shouldWarm !== undefined && typeof p.shouldWarm !== 'function') return false
  if (p.shouldCold !== undefined && typeof p.shouldCold !== 'function') return false

  // Cold threshold must be greater than warm threshold
  if (p.warmAfterMs !== undefined && p.coldAfterMs !== undefined) {
    if ((p.coldAfterMs as number) <= (p.warmAfterMs as number)) return false
  }
  if (p.warmAfterAccess !== undefined && p.coldAfterAccess !== undefined) {
    if ((p.coldAfterAccess as number) <= (p.warmAfterAccess as number)) return false
  }

  return true
}

// ============================================================================
// TIER METADATA
// ============================================================================

/**
 * Metadata for tracking tier decisions
 *
 * Stored alongside data to determine when to tier
 */
export interface TierMetadata {
  /** Current storage tier */
  tier: StorageTier
  /** Last access timestamp (ms since epoch) */
  lastAccess: number
  /** Total access count */
  accessCount: number
  /** Creation timestamp (ms since epoch) */
  createdAt: number
  /** Size in bytes (optional, for size-based tiering) */
  sizeBytes?: number
  /** Last modification timestamp (optional) */
  modifiedAt?: number
  /** Custom tags for tiering decisions */
  tags?: string[]
}

/**
 * Create default tier metadata
 */
export function createTierMetadata(tier: StorageTier = 'hot'): TierMetadata {
  const now = Date.now()
  return {
    tier,
    lastAccess: now,
    accessCount: 0,
    createdAt: now,
  }
}

/**
 * Update metadata on access
 */
export function updateAccessMetadata(metadata: TierMetadata): TierMetadata {
  return {
    ...metadata,
    lastAccess: Date.now(),
    accessCount: metadata.accessCount + 1,
  }
}

// ============================================================================
// TIERED DATA WRAPPER
// ============================================================================

/**
 * Data with tier metadata
 */
export interface TieredData<T> {
  /** The actual data */
  data: T
  /** Tier metadata */
  metadata: TierMetadata
}

/**
 * Create tiered data wrapper
 */
export function createTieredData<T>(data: T, tier: StorageTier = 'hot'): TieredData<T> {
  return {
    data,
    metadata: createTierMetadata(tier),
  }
}

// ============================================================================
// R2 TYPES
// ============================================================================

/**
 * R2 bucket interface (subset of Cloudflare R2Bucket)
 */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>
  put(key: string, value: ArrayBuffer | string, options?: R2PutOptions): Promise<R2ObjectLike>
  delete(key: string | string[]): Promise<void>
  list(options?: R2ListOptions): Promise<R2ObjectsLike>
  head(key: string): Promise<R2ObjectLike | null>
}

/**
 * R2 object interface (subset of Cloudflare R2Object)
 */
export interface R2ObjectLike {
  key: string
  size: number
  etag: string
  uploaded: Date
  customMetadata?: Record<string, string>
  body?: ReadableStream<Uint8Array>
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
}

/**
 * R2 put options
 */
export interface R2PutOptions {
  customMetadata?: Record<string, string>
  httpMetadata?: {
    contentType?: string
    contentEncoding?: string
  }
}

/**
 * R2 list options
 */
export interface R2ListOptions {
  prefix?: string
  cursor?: string
  limit?: number
  delimiter?: string
}

/**
 * R2 list result
 */
export interface R2ObjectsLike {
  objects: Array<{ key: string; size: number; uploaded: Date }>
  truncated: boolean
  cursor?: string
  delimitedPrefixes?: string[]
}

// ============================================================================
// TIER OPERATION RESULT
// ============================================================================

/**
 * Result of a tier operation
 */
export interface TierOperationResult {
  /** Whether the operation succeeded */
  success: boolean
  /** Source tier (if applicable) */
  fromTier?: StorageTier
  /** Destination tier (if applicable) */
  toTier?: StorageTier
  /** Key that was operated on */
  key: string
  /** Error message if failed */
  error?: string
  /** Operation duration in ms */
  durationMs?: number
}

/**
 * Batch tier operation result
 */
export interface BatchTierResult {
  /** Total keys processed */
  total: number
  /** Successfully tiered */
  succeeded: number
  /** Failed to tier */
  failed: number
  /** Individual results */
  results: TierOperationResult[]
}
