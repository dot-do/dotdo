/**
 * Percentage-based Bucketing for Feature Flags
 *
 * Provides deterministic percentage bucketing using consistent hashing (MurmurHash3).
 * Supports gradual rollouts, A/B testing, and weighted variant selection.
 *
 * @module db/primitives/feature-flags/percentage-bucketing
 */

import { murmurHash3 } from '../utils/murmur3'

// =============================================================================
// Types
// =============================================================================

/**
 * A weighted variant for percentage-based selection
 */
export interface WeightedVariant<T> {
  /** The value to return if this variant is selected */
  value: T
  /** Weight as percentage (0-100). All weights in a variant array should sum to 100 */
  weight: number
}

/**
 * Bucket override for sticky bucketing
 */
export interface BucketOverride {
  /** Flag key */
  flagKey: string
  /** User ID */
  userId: string
  /** Override bucket value (0 to bucketCount-1) */
  bucket: number
}

/**
 * Audit record for debugging bucketing decisions
 */
export interface BucketAuditRecord {
  /** Timestamp of the bucketing decision */
  timestamp: number
  /** Flag key */
  flagKey: string
  /** User ID */
  userId: string
  /** Salt used for hashing */
  salt: string
  /** Computed hash value */
  hashValue: number
  /** Final bucket (after modulo) */
  bucket: number
  /** Whether an override was applied */
  overrideApplied: boolean
  /** Total bucket count */
  bucketCount: number
}

/**
 * Configuration for percentage bucketing
 */
export interface PercentageBucketingConfig {
  /** Number of buckets (default: 10000 for 0.01% precision) */
  bucketCount?: number
  /** Optional bucket overrides for sticky bucketing */
  overrides?: Map<string, number>
  /** Enable audit logging */
  enableAudit?: boolean
  /** Maximum audit records to keep */
  maxAuditRecords?: number
}

/**
 * Percentage bucketing interface
 */
export interface PercentageBucketing {
  /**
   * Get the bucket for a user/flag combination
   * @param flagKey - Feature flag key
   * @param userId - User identifier
   * @param salt - Optional salt (defaults to flagKey)
   * @returns Bucket number (0 to bucketCount-1)
   */
  getBucket(flagKey: string, userId: string, salt?: string): number

  /**
   * Check if a user is in a percentage rollout
   * @param flagKey - Feature flag key
   * @param userId - User identifier
   * @param percentage - Rollout percentage (0-100)
   * @returns true if user is in the rollout
   */
  isInRollout(flagKey: string, userId: string, percentage: number): boolean

  /**
   * Get a weighted variant for a user
   * @param flagKey - Feature flag key
   * @param userId - User identifier
   * @param variants - Array of weighted variants (weights should sum to 100)
   * @returns Selected variant value
   */
  getVariant<T>(flagKey: string, userId: string, variants: WeightedVariant<T>[]): T
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Default bucket count - 10000 provides 0.01% precision
 */
const DEFAULT_BUCKET_COUNT = 10000

/**
 * Create a unique key for override lookup
 */
function overrideKey(flagKey: string, userId: string): string {
  return `${flagKey}:${userId}`
}

/**
 * Creates a percentage bucketing instance with the specified configuration
 *
 * @param config - Optional configuration
 * @returns PercentageBucketing instance
 */
export function createPercentageBucketing(config: PercentageBucketingConfig = {}): PercentageBucketing & {
  setOverride: (flagKey: string, userId: string, bucket: number) => void
  removeOverride: (flagKey: string, userId: string) => void
  clearOverrides: () => void
  getAuditLog: () => BucketAuditRecord[]
  clearAuditLog: () => void
  getBucketCount: () => number
} {
  const bucketCount = config.bucketCount ?? DEFAULT_BUCKET_COUNT
  const overrides = config.overrides ?? new Map<string, number>()
  const enableAudit = config.enableAudit ?? false
  const maxAuditRecords = config.maxAuditRecords ?? 1000
  const auditLog: BucketAuditRecord[] = []

  /**
   * Record an audit entry
   */
  function recordAudit(
    flagKey: string,
    userId: string,
    salt: string,
    hashValue: number,
    bucket: number,
    overrideApplied: boolean
  ): void {
    if (!enableAudit) return

    const record: BucketAuditRecord = {
      timestamp: Date.now(),
      flagKey,
      userId,
      salt,
      hashValue,
      bucket,
      overrideApplied,
      bucketCount,
    }

    auditLog.push(record)

    // Trim audit log if it exceeds max size
    while (auditLog.length > maxAuditRecords) {
      auditLog.shift()
    }
  }

  /**
   * Compute bucket using consistent hashing
   */
  function computeBucket(flagKey: string, userId: string, salt: string): { bucket: number; hashValue: number } {
    // Combine flagKey, salt, and userId for hashing
    // Using salt as seed provides correlation prevention between flags
    const hashInput = `${flagKey}.${salt}.${userId}`

    // Hash using MurmurHash3 with a fixed seed
    // The salt is incorporated into the input string rather than the seed
    // to ensure different salts produce different hash distributions
    const hashValue = murmurHash3(hashInput, 0)

    // Normalize to bucket range using modulo
    // Using unsigned hash value (murmurHash3 returns unsigned 32-bit)
    const bucket = hashValue % bucketCount

    return { bucket, hashValue }
  }

  /**
   * Get bucket for a user/flag combination
   */
  function getBucket(flagKey: string, userId: string, salt?: string): number {
    const effectiveSalt = salt ?? flagKey

    // Check for override first (sticky bucketing)
    const key = overrideKey(flagKey, userId)
    const override = overrides.get(key)

    if (override !== undefined) {
      recordAudit(flagKey, userId, effectiveSalt, 0, override, true)
      return override
    }

    // Compute bucket using consistent hashing
    const { bucket, hashValue } = computeBucket(flagKey, userId, effectiveSalt)

    recordAudit(flagKey, userId, effectiveSalt, hashValue, bucket, false)

    return bucket
  }

  /**
   * Check if user is in a percentage rollout
   */
  function isInRollout(flagKey: string, userId: string, percentage: number): boolean {
    if (percentage <= 0) return false
    if (percentage >= 100) return true

    const bucket = getBucket(flagKey, userId)

    // Convert percentage to bucket threshold
    // percentage=50 means buckets 0-4999 are in rollout (for 10000 buckets)
    const threshold = Math.floor((percentage / 100) * bucketCount)

    return bucket < threshold
  }

  /**
   * Get weighted variant for a user
   */
  function getVariant<T>(flagKey: string, userId: string, variants: WeightedVariant<T>[]): T {
    if (variants.length === 0) {
      throw new Error('Variants array cannot be empty')
    }

    if (variants.length === 1) {
      return variants[0]!.value
    }

    const bucket = getBucket(flagKey, userId)

    // Normalize bucket to percentage (0-100 scale with decimal precision)
    const bucketPercentage = (bucket / bucketCount) * 100

    // Select variant based on cumulative weights
    let cumulativeWeight = 0
    for (const variant of variants) {
      cumulativeWeight += variant.weight
      if (bucketPercentage < cumulativeWeight) {
        return variant.value
      }
    }

    // Fallback to last variant (handles rounding issues)
    return variants[variants.length - 1]!.value
  }

  /**
   * Set a bucket override for sticky bucketing
   */
  function setOverride(flagKey: string, userId: string, bucket: number): void {
    if (bucket < 0 || bucket >= bucketCount) {
      throw new Error(`Bucket must be between 0 and ${bucketCount - 1}`)
    }
    const key = overrideKey(flagKey, userId)
    overrides.set(key, bucket)
  }

  /**
   * Remove a bucket override
   */
  function removeOverride(flagKey: string, userId: string): void {
    const key = overrideKey(flagKey, userId)
    overrides.delete(key)
  }

  /**
   * Clear all overrides
   */
  function clearOverrides(): void {
    overrides.clear()
  }

  /**
   * Get the audit log
   */
  function getAuditLog(): BucketAuditRecord[] {
    return [...auditLog]
  }

  /**
   * Clear the audit log
   */
  function clearAuditLog(): void {
    auditLog.length = 0
  }

  /**
   * Get the bucket count
   */
  function getBucketCount(): number {
    return bucketCount
  }

  return {
    getBucket,
    isInRollout,
    getVariant,
    setOverride,
    removeOverride,
    clearOverrides,
    getAuditLog,
    clearAuditLog,
    getBucketCount,
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a random salt for flag correlation prevention
 * @returns A random 16-character hex string
 */
export function generateFlagSalt(): string {
  const chars = '0123456789abcdef'
  let result = ''
  for (let i = 0; i < 16; i++) {
    result += chars[Math.floor(Math.random() * 16)]
  }
  return result
}

/**
 * Validate that variant weights sum to 100
 * @param variants - Array of weighted variants
 * @returns true if weights sum to 100 (within floating point tolerance)
 */
export function validateVariantWeights<T>(variants: WeightedVariant<T>[]): boolean {
  const total = variants.reduce((sum, v) => sum + v.weight, 0)
  return Math.abs(total - 100) < 0.001
}

/**
 * Calculate the expected percentage of users in a rollout
 * @param percentage - Rollout percentage (0-100)
 * @param bucketCount - Number of buckets (default: 10000)
 * @returns Expected percentage with bucket granularity
 */
export function expectedRolloutPercentage(percentage: number, bucketCount: number = DEFAULT_BUCKET_COUNT): number {
  const threshold = Math.floor((percentage / 100) * bucketCount)
  return (threshold / bucketCount) * 100
}

/**
 * Simulate rollout distribution for testing
 * @param flagKey - Feature flag key
 * @param userCount - Number of users to simulate
 * @param percentage - Rollout percentage
 * @param config - Optional bucketing config
 * @returns Object with in/out counts and actual percentage
 */
export function simulateRollout(
  flagKey: string,
  userCount: number,
  percentage: number,
  config?: PercentageBucketingConfig
): { inCount: number; outCount: number; actualPercentage: number } {
  const bucketing = createPercentageBucketing(config)

  let inCount = 0
  for (let i = 0; i < userCount; i++) {
    const userId = `user-${i}`
    if (bucketing.isInRollout(flagKey, userId, percentage)) {
      inCount++
    }
  }

  return {
    inCount,
    outCount: userCount - inCount,
    actualPercentage: (inCount / userCount) * 100,
  }
}

/**
 * Simulate variant distribution for testing
 * @param flagKey - Feature flag key
 * @param userCount - Number of users to simulate
 * @param variants - Array of weighted variants
 * @param config - Optional bucketing config
 * @returns Map of variant values to their counts
 */
export function simulateVariantDistribution<T>(
  flagKey: string,
  userCount: number,
  variants: WeightedVariant<T>[],
  config?: PercentageBucketingConfig
): Map<T, number> {
  const bucketing = createPercentageBucketing(config)
  const distribution = new Map<T, number>()

  for (let i = 0; i < userCount; i++) {
    const userId = `user-${i}`
    const variant = bucketing.getVariant(flagKey, userId, variants)
    distribution.set(variant, (distribution.get(variant) ?? 0) + 1)
  }

  return distribution
}

// =============================================================================
// Default Export
// =============================================================================

/**
 * Default percentage bucketing instance with standard configuration
 */
export const percentageBucketing = createPercentageBucketing()
