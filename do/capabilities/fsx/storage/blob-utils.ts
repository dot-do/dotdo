/**
 * Blob Management Utilities
 *
 * Shared utilities for content-addressable blob storage:
 * - Hash computation (SHA-256)
 * - Blob ID generation
 * - Deduplication helpers
 * - Tier transition validation
 * - Cleanup scheduling
 *
 * @module storage/blob-utils
 */

import { sha256 } from '../core/cas/hash.js'
import type { StorageTier } from '../core/index.js'

// =============================================================================
// Blob ID Generation
// =============================================================================

/**
 * Prefix for content-addressable blob IDs.
 * Using a prefix helps identify blobs and prevents ID collisions.
 */
export const BLOB_ID_PREFIX = 'blob-'

/**
 * Compute SHA-256 checksum of data.
 *
 * Uses the Web Crypto API for efficient, hardware-accelerated hashing.
 * Returns a 64-character lowercase hex string.
 *
 * @param data - Binary data to hash
 * @returns 64-character hex checksum
 *
 * @example
 * ```typescript
 * const checksum = await computeChecksum(new TextEncoder().encode('hello'))
 * console.log(checksum) // '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
 * ```
 */
export async function computeChecksum(data: Uint8Array): Promise<string> {
  return sha256(data)
}

/**
 * Generate a content-addressable blob ID from data.
 *
 * The blob ID is derived from the SHA-256 hash of the content,
 * ensuring identical content always maps to the same ID.
 *
 * @param data - Binary data to generate ID for
 * @returns Content-addressable blob ID
 *
 * @example
 * ```typescript
 * const id = await generateBlobId(new TextEncoder().encode('hello'))
 * console.log(id) // 'blob-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
 * ```
 */
export async function generateBlobId(data: Uint8Array): Promise<string> {
  const checksum = await computeChecksum(data)
  return `${BLOB_ID_PREFIX}${checksum}`
}

/**
 * Generate blob ID from a pre-computed checksum.
 *
 * Use this when the checksum is already available to avoid re-hashing.
 *
 * @param checksum - Pre-computed SHA-256 checksum
 * @returns Content-addressable blob ID
 */
export function blobIdFromChecksum(checksum: string): string {
  return `${BLOB_ID_PREFIX}${checksum}`
}

/**
 * Extract checksum from a blob ID.
 *
 * @param blobId - Content-addressable blob ID
 * @returns The checksum portion of the ID, or null if invalid format
 */
export function checksumFromBlobId(blobId: string): string | null {
  if (!blobId.startsWith(BLOB_ID_PREFIX)) return null
  return blobId.slice(BLOB_ID_PREFIX.length)
}

/**
 * Check if a blob ID is valid (has correct prefix and checksum length).
 *
 * @param blobId - Blob ID to validate
 * @returns true if valid blob ID format
 */
export function isValidBlobId(blobId: string): boolean {
  if (!blobId.startsWith(BLOB_ID_PREFIX)) return false
  const checksum = blobId.slice(BLOB_ID_PREFIX.length)
  // SHA-256 produces 64 hex characters
  return /^[0-9a-f]{64}$/i.test(checksum)
}

// =============================================================================
// Tier Transitions
// =============================================================================

/**
 * Valid tier transition types.
 */
export type TierTransition = 'promote' | 'demote' | 'none'

/**
 * Tier ordering for transition validation.
 * Lower index = hotter tier (faster, more expensive).
 */
const TIER_ORDER: readonly StorageTier[] = ['hot', 'warm', 'cold'] as const

/**
 * Get the tier order index (lower = hotter).
 */
function getTierIndex(tier: StorageTier): number {
  return TIER_ORDER.indexOf(tier)
}

/**
 * Determine the type of tier transition.
 *
 * @param from - Current tier
 * @param to - Target tier
 * @returns 'promote' (moving hotter), 'demote' (moving colder), or 'none' (same tier)
 */
export function getTierTransition(from: StorageTier, to: StorageTier): TierTransition {
  const fromIndex = getTierIndex(from)
  const toIndex = getTierIndex(to)

  if (fromIndex === toIndex) return 'none'
  if (toIndex < fromIndex) return 'promote'
  return 'demote'
}

/**
 * Check if a tier transition is valid.
 *
 * All transitions are technically valid, but this function
 * can be extended to enforce policies (e.g., no skip transitions).
 *
 * @param from - Current tier
 * @param to - Target tier
 * @param allowSkip - Whether to allow skipping tiers (e.g., cold -> hot)
 * @returns true if the transition is valid
 */
export function isValidTierTransition(
  from: StorageTier,
  to: StorageTier,
  allowSkip = true
): boolean {
  if (from === to) return true
  if (allowSkip) return true

  // Disallow skipping tiers (e.g., must go hot -> warm -> cold, not hot -> cold)
  const fromIndex = getTierIndex(from)
  const toIndex = getTierIndex(to)
  return Math.abs(fromIndex - toIndex) === 1
}

/**
 * Select the appropriate tier based on blob size.
 *
 * This implements the default tiering policy:
 * - Small blobs (< hotMaxSize) -> hot tier (SQLite)
 * - Large blobs (>= hotMaxSize) -> warm tier (R2)
 *
 * @param size - Blob size in bytes
 * @param hotMaxSize - Maximum size for hot tier (default: 1MB)
 * @param hasR2 - Whether R2 storage is available
 * @returns Recommended storage tier
 */
export function selectTierBySize(
  size: number,
  hotMaxSize = 1024 * 1024,
  hasR2 = true
): StorageTier {
  if (size <= hotMaxSize) return 'hot'
  if (hasR2) return 'warm'
  return 'hot' // Fall back to hot if R2 not available
}

// =============================================================================
// Cleanup Scheduling
// =============================================================================

/**
 * Configuration for scheduled blob cleanup.
 */
export interface CleanupConfig {
  /**
   * Minimum number of orphaned blobs before triggering cleanup.
   * @default 10
   */
  minOrphanCount?: number

  /**
   * Minimum age (ms) of orphaned blobs before they can be cleaned.
   * Provides a grace period for concurrent operations.
   * @default 60000 (1 minute)
   */
  minOrphanAgeMs?: number

  /**
   * Maximum number of blobs to clean in a single batch.
   * @default 100
   */
  batchSize?: number

  /**
   * Whether to run cleanup in background (non-blocking).
   * @default true
   */
  async?: boolean
}

/**
 * Default cleanup configuration.
 */
export const DEFAULT_CLEANUP_CONFIG: Required<CleanupConfig> = {
  minOrphanCount: 10,
  minOrphanAgeMs: 60000, // 1 minute grace period
  batchSize: 100,
  async: true,
}

/**
 * Result of a cleanup operation.
 */
export interface CleanupResult {
  /** Number of blobs cleaned up */
  cleaned: number
  /** Number of blobs skipped (e.g., too recent) */
  skipped: number
  /** Total orphaned blobs found */
  found: number
  /** Time taken in milliseconds */
  durationMs: number
}

/**
 * Cleanup scheduler state.
 */
export interface CleanupSchedulerState {
  /** Last cleanup timestamp */
  lastCleanup: number
  /** Number of cleanups performed */
  cleanupCount: number
  /** Total blobs cleaned */
  totalCleaned: number
  /** Whether cleanup is currently running */
  running: boolean
}

/**
 * Create initial cleanup scheduler state.
 */
export function createCleanupSchedulerState(): CleanupSchedulerState {
  return {
    lastCleanup: 0,
    cleanupCount: 0,
    totalCleaned: 0,
    running: false,
  }
}

// =============================================================================
// Deduplication Helpers
// =============================================================================

/**
 * Result of a deduplication check.
 */
export interface DedupCheckResult {
  /** Whether the blob already exists */
  exists: boolean
  /** The blob ID (same for both existing and new) */
  blobId: string
  /** Checksum of the content */
  checksum: string
}

/**
 * Check if content already exists and return dedup info.
 *
 * This is a helper for building dedup-aware storage operations.
 * The actual database check must be performed by the caller.
 *
 * @param data - Binary data to check
 * @returns Dedup check result with blobId and checksum
 */
export async function prepareDedupCheck(data: Uint8Array): Promise<Omit<DedupCheckResult, 'exists'>> {
  const checksum = await computeChecksum(data)
  const blobId = blobIdFromChecksum(checksum)
  return { blobId, checksum }
}

// =============================================================================
// Blob Statistics
// =============================================================================

/**
 * Blob storage statistics.
 */
export interface BlobStats {
  /** Total number of unique blobs */
  totalBlobs: number
  /** Total file references to blobs */
  totalRefs: number
  /** Average references per blob */
  avgRefsPerBlob: number
  /** Total bytes stored */
  totalBytes: number
  /** Bytes saved by deduplication */
  savedBytes: number
  /** Deduplication ratio (refs / blobs) */
  dedupRatio: number
  /** Stats by tier */
  byTier: Record<StorageTier, { count: number; bytes: number }>
}

/**
 * Calculate deduplication savings.
 *
 * @param totalBlobs - Number of unique blobs
 * @param totalRefs - Total number of file references
 * @param avgBlobSize - Average blob size in bytes
 * @returns Bytes saved by deduplication
 */
export function calculateDedupSavings(
  totalBlobs: number,
  totalRefs: number,
  avgBlobSize: number
): number {
  if (totalBlobs === 0) return 0
  // Without dedup, we would store (totalRefs) copies
  // With dedup, we store (totalBlobs) copies
  const duplicateRefs = Math.max(0, totalRefs - totalBlobs)
  return Math.round(duplicateRefs * avgBlobSize)
}

/**
 * Calculate deduplication ratio.
 *
 * A ratio of 1.0 means no deduplication benefit.
 * Higher ratios indicate more deduplication savings.
 *
 * @param totalBlobs - Number of unique blobs
 * @param totalRefs - Total number of file references
 * @returns Deduplication ratio (>= 1.0)
 */
export function calculateDedupRatio(totalBlobs: number, totalRefs: number): number {
  if (totalBlobs === 0) return 1.0
  return totalRefs / totalBlobs
}
