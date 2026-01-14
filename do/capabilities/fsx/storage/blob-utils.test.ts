/**
 * Tests for Blob Management Utilities
 *
 * Verifies the shared blob utilities extracted during refactoring:
 * - Hash computation and blob ID generation
 * - Tier transition logic
 * - Cleanup scheduling helpers
 */

import { describe, it, expect } from 'vitest'
import {
  computeChecksum,
  generateBlobId,
  blobIdFromChecksum,
  checksumFromBlobId,
  isValidBlobId,
  BLOB_ID_PREFIX,
  selectTierBySize,
  getTierTransition,
  isValidTierTransition,
  createCleanupSchedulerState,
  DEFAULT_CLEANUP_CONFIG,
  prepareDedupCheck,
  calculateDedupSavings,
  calculateDedupRatio,
} from './blob-utils.js'

describe('Blob ID Generation', () => {
  it('should compute consistent checksums', async () => {
    const data = new TextEncoder().encode('hello world')
    const checksum1 = await computeChecksum(data)
    const checksum2 = await computeChecksum(data)

    expect(checksum1).toBe(checksum2)
    expect(checksum1).toHaveLength(64) // SHA-256 = 64 hex chars
  })

  it('should generate blob ID from data', async () => {
    const data = new TextEncoder().encode('test content')
    const blobId = await generateBlobId(data)

    expect(blobId.startsWith(BLOB_ID_PREFIX)).toBe(true)
    expect(blobId).toHaveLength(BLOB_ID_PREFIX.length + 64)
  })

  it('should generate blob ID from checksum', () => {
    const checksum = 'a'.repeat(64)
    const blobId = blobIdFromChecksum(checksum)

    expect(blobId).toBe(`${BLOB_ID_PREFIX}${checksum}`)
  })

  it('should extract checksum from blob ID', () => {
    const checksum = 'b'.repeat(64)
    const blobId = `${BLOB_ID_PREFIX}${checksum}`

    expect(checksumFromBlobId(blobId)).toBe(checksum)
  })

  it('should return null for invalid blob ID', () => {
    expect(checksumFromBlobId('invalid-id')).toBeNull()
    expect(checksumFromBlobId('other-prefix-abc')).toBeNull()
  })

  it('should validate blob IDs', () => {
    const validChecksum = 'c'.repeat(64)
    const validBlobId = `${BLOB_ID_PREFIX}${validChecksum}`

    expect(isValidBlobId(validBlobId)).toBe(true)
    expect(isValidBlobId('invalid')).toBe(false)
    expect(isValidBlobId(`${BLOB_ID_PREFIX}short`)).toBe(false)
    expect(isValidBlobId(`${BLOB_ID_PREFIX}${'g'.repeat(64)}`)).toBe(false) // Invalid hex
  })
})

describe('Tier Selection', () => {
  it('should select hot tier for small blobs', () => {
    expect(selectTierBySize(100)).toBe('hot')
    expect(selectTierBySize(1024 * 1024)).toBe('hot') // Exactly 1MB
  })

  it('should select warm tier for large blobs with R2', () => {
    expect(selectTierBySize(1024 * 1024 + 1, 1024 * 1024, true)).toBe('warm')
    expect(selectTierBySize(10 * 1024 * 1024, 1024 * 1024, true)).toBe('warm')
  })

  it('should fallback to hot without R2', () => {
    expect(selectTierBySize(10 * 1024 * 1024, 1024 * 1024, false)).toBe('hot')
  })

  it('should respect custom hot max size', () => {
    expect(selectTierBySize(500 * 1024, 512 * 1024, true)).toBe('hot')
    expect(selectTierBySize(600 * 1024, 512 * 1024, true)).toBe('warm')
  })
})

describe('Tier Transitions', () => {
  it('should identify promotion transitions', () => {
    expect(getTierTransition('cold', 'warm')).toBe('promote')
    expect(getTierTransition('warm', 'hot')).toBe('promote')
    expect(getTierTransition('cold', 'hot')).toBe('promote')
  })

  it('should identify demotion transitions', () => {
    expect(getTierTransition('hot', 'warm')).toBe('demote')
    expect(getTierTransition('warm', 'cold')).toBe('demote')
    expect(getTierTransition('hot', 'cold')).toBe('demote')
  })

  it('should identify no transition', () => {
    expect(getTierTransition('hot', 'hot')).toBe('none')
    expect(getTierTransition('warm', 'warm')).toBe('none')
    expect(getTierTransition('cold', 'cold')).toBe('none')
  })

  it('should validate transitions', () => {
    // All transitions valid by default
    expect(isValidTierTransition('hot', 'cold', true)).toBe(true)
    expect(isValidTierTransition('cold', 'hot', true)).toBe(true)

    // Skip not allowed when allowSkip=false
    expect(isValidTierTransition('hot', 'cold', false)).toBe(false)
    expect(isValidTierTransition('cold', 'hot', false)).toBe(false)

    // Adjacent transitions always valid
    expect(isValidTierTransition('hot', 'warm', false)).toBe(true)
    expect(isValidTierTransition('warm', 'cold', false)).toBe(true)
    expect(isValidTierTransition('warm', 'hot', false)).toBe(true)
    expect(isValidTierTransition('cold', 'warm', false)).toBe(true)

    // Same tier always valid
    expect(isValidTierTransition('hot', 'hot', false)).toBe(true)
  })
})

describe('Cleanup Scheduling', () => {
  it('should create initial scheduler state', () => {
    const state = createCleanupSchedulerState()

    expect(state.lastCleanup).toBe(0)
    expect(state.cleanupCount).toBe(0)
    expect(state.totalCleaned).toBe(0)
    expect(state.running).toBe(false)
  })

  it('should have sensible default config', () => {
    expect(DEFAULT_CLEANUP_CONFIG.minOrphanCount).toBe(10)
    expect(DEFAULT_CLEANUP_CONFIG.minOrphanAgeMs).toBe(60000)
    expect(DEFAULT_CLEANUP_CONFIG.batchSize).toBe(100)
    expect(DEFAULT_CLEANUP_CONFIG.async).toBe(true)
  })
})

describe('Deduplication Helpers', () => {
  it('should prepare dedup check info', async () => {
    const data = new TextEncoder().encode('test data')
    const result = await prepareDedupCheck(data)

    expect(result.blobId).toContain(BLOB_ID_PREFIX)
    expect(result.checksum).toHaveLength(64)
  })

  it('should calculate dedup savings', () => {
    // 10 blobs, 30 refs, 1KB average = (30-10) * 1024 = 20KB saved
    expect(calculateDedupSavings(10, 30, 1024)).toBe(20 * 1024)

    // No savings if same number of refs as blobs
    expect(calculateDedupSavings(10, 10, 1024)).toBe(0)

    // No savings with no blobs
    expect(calculateDedupSavings(0, 0, 1024)).toBe(0)
  })

  it('should calculate dedup ratio', () => {
    // 10 blobs, 30 refs = ratio of 3.0
    expect(calculateDedupRatio(10, 30)).toBe(3.0)

    // No dedup = ratio of 1.0
    expect(calculateDedupRatio(10, 10)).toBe(1.0)

    // No blobs = ratio of 1.0
    expect(calculateDedupRatio(0, 0)).toBe(1.0)
  })
})
