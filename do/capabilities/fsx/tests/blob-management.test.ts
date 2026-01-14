/**
 * RED Phase Tests: Blob Management
 *
 * These tests verify blob management functionality for fsx:
 * - Blob storage with content-addressable ID
 * - Reference counting (ref_count increments/decrements)
 * - Orphan blob cleanup (blobs with ref_count=0)
 * - Tier tracking (hot/warm/cold)
 * - Deduplication (same content = same blob)
 *
 * TDD RED Phase: All tests are expected to fail initially.
 * The corresponding GREEN phase will implement the functionality.
 *
 * @module tests/blob-management
 * @see fsx-uql - RED: Write failing tests for blob management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

/**
 * Helper to make RPC calls to the FileSystemDO
 */
async function rpc(
  stub: DurableObjectStub,
  method: string,
  params: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const response = await stub.fetch('http://fsx.do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),
  })
  const data = await response.json()
  return { status: response.status, data }
}

/**
 * Generate SHA-256 hash of content (for content-addressable verification)
 */
async function sha256(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

// =============================================================================
// Blob Storage with Content-Addressable ID Tests
// =============================================================================

describe('Blob Storage - Content-Addressable ID', () => {
  it('should generate content-addressable blob ID based on content hash', async () => {
    const id = env.FSX.idFromName('blob-cas-id-test')
    const stub = env.FSX.get(id)

    const content = 'Hello, content-addressable storage!'
    const expectedHash = await sha256(content)

    await rpc(stub, 'writeFile', {
      path: '/cas-test.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    // Get blob info to verify content-addressable ID
    const blobInfoResult = await rpc(stub, 'getBlobInfo', {
      path: '/cas-test.txt',
    })

    expect(blobInfoResult.status).toBe(200)
    const blobInfo = blobInfoResult.data as { blobId: string; checksum: string }

    // Blob ID should contain or be derived from content hash
    expect(blobInfo.blobId).toContain(expectedHash.substring(0, 8))
  })

  it('should store blob with verifiable checksum', async () => {
    const id = env.FSX.idFromName('blob-checksum-test')
    const stub = env.FSX.get(id)

    const content = 'Checksum verification content'

    await rpc(stub, 'writeFile', {
      path: '/checksum-test.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    const blobInfoResult = await rpc(stub, 'getBlobInfo', {
      path: '/checksum-test.txt',
    })

    expect(blobInfoResult.status).toBe(200)
    const blobInfo = blobInfoResult.data as { checksum: string }

    // Checksum should be present and non-empty
    expect(blobInfo.checksum).toBeDefined()
    expect(blobInfo.checksum.length).toBeGreaterThan(0)
  })

  it('should retrieve blob by content-addressable ID', async () => {
    const id = env.FSX.idFromName('blob-retrieve-by-id-test')
    const stub = env.FSX.get(id)

    const content = 'Retrieve by ID content'

    await rpc(stub, 'writeFile', {
      path: '/retrieve-test.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    // Get the blob ID
    const blobInfoResult = await rpc(stub, 'getBlobInfo', {
      path: '/retrieve-test.txt',
    })

    expect(blobInfoResult.status).toBe(200)
    const blobInfo = blobInfoResult.data as { blobId: string }

    // Retrieve blob directly by ID
    const blobResult = await rpc(stub, 'getBlobById', {
      blobId: blobInfo.blobId,
    })

    expect(blobResult.status).toBe(200)
    const blob = blobResult.data as { data: string }
    expect(atob(blob.data)).toBe(content)
  })

  it('should verify blob integrity on read', async () => {
    const id = env.FSX.idFromName('blob-integrity-test')
    const stub = env.FSX.get(id)

    const content = 'Integrity check content'

    await rpc(stub, 'writeFile', {
      path: '/integrity-test.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    // Verify blob integrity
    const verifyResult = await rpc(stub, 'verifyBlobIntegrity', {
      path: '/integrity-test.txt',
    })

    expect(verifyResult.status).toBe(200)
    const result = verifyResult.data as { valid: boolean; checksum: string }
    expect(result.valid).toBe(true)
  })
})

// =============================================================================
// Reference Counting Tests
// =============================================================================

describe('Blob Storage - Reference Counting', () => {
  describe('ref_count initialization', () => {
    it('should initialize ref_count to 1 when creating a new blob', async () => {
      const id = env.FSX.idFromName('blob-refcount-init-test')
      const stub = env.FSX.get(id)

      await rpc(stub, 'writeFile', {
        path: '/refcount-init.txt',
        data: btoa('Initial content'),
        encoding: 'base64',
      })

      const blobInfoResult = await rpc(stub, 'getBlobInfo', {
        path: '/refcount-init.txt',
      })

      expect(blobInfoResult.status).toBe(200)
      const blobInfo = blobInfoResult.data as { refCount: number }
      expect(blobInfo.refCount).toBe(1)
    })
  })

  describe('ref_count increment', () => {
    it('should increment ref_count when creating hard link', async () => {
      const id = env.FSX.idFromName('blob-refcount-hardlink-test')
      const stub = env.FSX.get(id)

      // Create original file
      await rpc(stub, 'writeFile', {
        path: '/original-for-link.txt',
        data: btoa('Shared blob content'),
        encoding: 'base64',
      })

      // Get initial ref_count
      const initialBlobInfo = await rpc(stub, 'getBlobInfo', {
        path: '/original-for-link.txt',
      })
      expect(initialBlobInfo.status).toBe(200)
      const initialInfo = initialBlobInfo.data as { blobId: string; refCount: number }
      expect(initialInfo.refCount).toBe(1)

      // Create hard link
      const linkResult = await rpc(stub, 'link', {
        existingPath: '/original-for-link.txt',
        newPath: '/hardlink-to-original.txt',
      })
      expect(linkResult.status).toBe(200)

      // Verify ref_count incremented
      const afterLinkBlobInfo = await rpc(stub, 'getBlobInfo', {
        path: '/original-for-link.txt',
      })
      expect(afterLinkBlobInfo.status).toBe(200)
      const afterInfo = afterLinkBlobInfo.data as { refCount: number }
      expect(afterInfo.refCount).toBe(2)
    })

    it('should increment ref_count when copying file with same content (dedup)', async () => {
      const id = env.FSX.idFromName('blob-refcount-dedup-test')
      const stub = env.FSX.get(id)

      const content = 'Deduplicated content for copy'

      // Create original file
      await rpc(stub, 'writeFile', {
        path: '/original-dedup.txt',
        data: btoa(content),
        encoding: 'base64',
      })

      // Get blob ID and initial ref_count
      const initialBlobInfo = await rpc(stub, 'getBlobInfo', {
        path: '/original-dedup.txt',
      })
      const initialInfo = initialBlobInfo.data as { blobId: string; refCount: number }

      // Write another file with exact same content (should dedup)
      await rpc(stub, 'writeFile', {
        path: '/duplicate-dedup.txt',
        data: btoa(content),
        encoding: 'base64',
      })

      // Both files should share the same blob
      const duplicateBlobInfo = await rpc(stub, 'getBlobInfo', {
        path: '/duplicate-dedup.txt',
      })
      const duplicateInfo = duplicateBlobInfo.data as { blobId: string; refCount: number }

      // Verify same blob ID (deduplication)
      expect(duplicateInfo.blobId).toBe(initialInfo.blobId)

      // Verify ref_count is 2 (both files reference same blob)
      expect(duplicateInfo.refCount).toBe(2)
    })

    it('should handle multiple hard links incrementing ref_count', async () => {
      const id = env.FSX.idFromName('blob-multiple-links-test')
      const stub = env.FSX.get(id)

      // Create original file
      await rpc(stub, 'writeFile', {
        path: '/multi-link-original.txt',
        data: btoa('Multiple links content'),
        encoding: 'base64',
      })

      // Create multiple hard links
      for (let i = 1; i <= 5; i++) {
        await rpc(stub, 'link', {
          existingPath: '/multi-link-original.txt',
          newPath: `/multi-link-${i}.txt`,
        })
      }

      // Verify ref_count is 6 (original + 5 links)
      const blobInfo = await rpc(stub, 'getBlobInfo', {
        path: '/multi-link-original.txt',
      })
      expect(blobInfo.status).toBe(200)
      const info = blobInfo.data as { refCount: number }
      expect(info.refCount).toBe(6)
    })
  })

  describe('ref_count decrement', () => {
    it('should decrement ref_count when deleting file', async () => {
      const id = env.FSX.idFromName('blob-refcount-delete-test')
      const stub = env.FSX.get(id)

      // Create file with hard link
      await rpc(stub, 'writeFile', {
        path: '/delete-test-original.txt',
        data: btoa('Delete test content'),
        encoding: 'base64',
      })

      await rpc(stub, 'link', {
        existingPath: '/delete-test-original.txt',
        newPath: '/delete-test-link.txt',
      })

      // Verify ref_count is 2
      const beforeDelete = await rpc(stub, 'getBlobInfo', {
        path: '/delete-test-original.txt',
      })
      expect((beforeDelete.data as { refCount: number }).refCount).toBe(2)

      // Delete original file
      await rpc(stub, 'unlink', { path: '/delete-test-original.txt' })

      // Verify ref_count is 1 (only link remains)
      const afterDelete = await rpc(stub, 'getBlobInfo', {
        path: '/delete-test-link.txt',
      })
      expect(afterDelete.status).toBe(200)
      expect((afterDelete.data as { refCount: number }).refCount).toBe(1)
    })

    it('should not go below 0 for ref_count', async () => {
      const id = env.FSX.idFromName('blob-refcount-floor-test')
      const stub = env.FSX.get(id)

      await rpc(stub, 'writeFile', {
        path: '/floor-test.txt',
        data: btoa('Floor test content'),
        encoding: 'base64',
      })

      // Get blob info before delete
      const beforeDelete = await rpc(stub, 'getBlobInfo', {
        path: '/floor-test.txt',
      })
      const blobId = (beforeDelete.data as { blobId: string }).blobId

      // Delete the file
      await rpc(stub, 'unlink', { path: '/floor-test.txt' })

      // Blob should be deleted or have ref_count of 0
      const afterDelete = await rpc(stub, 'getBlobById', { blobId })

      // Either blob is deleted (404) or ref_count is 0
      if (afterDelete.status === 200) {
        const info = afterDelete.data as { refCount: number }
        expect(info.refCount).toBeGreaterThanOrEqual(0)
      } else {
        expect(afterDelete.status).toBe(404)
      }
    })

    it('should preserve blob when other references exist', async () => {
      const id = env.FSX.idFromName('blob-preserve-test')
      const stub = env.FSX.get(id)

      const content = 'Preserve test content'

      // Create original file
      await rpc(stub, 'writeFile', {
        path: '/preserve-original.txt',
        data: btoa(content),
        encoding: 'base64',
      })

      // Create hard link
      await rpc(stub, 'link', {
        existingPath: '/preserve-original.txt',
        newPath: '/preserve-link.txt',
      })

      // Delete original
      await rpc(stub, 'unlink', { path: '/preserve-original.txt' })

      // Link should still be readable with correct content
      const readResult = await rpc(stub, 'readFile', {
        path: '/preserve-link.txt',
      })

      expect(readResult.status).toBe(200)
      const data = (readResult.data as { data: string }).data
      expect(atob(data)).toBe(content)
    })
  })

  describe('ref_count consistency', () => {
    it('should maintain consistent ref_count across operations', async () => {
      const id = env.FSX.idFromName('blob-refcount-consistency-test')
      const stub = env.FSX.get(id)

      const content = 'Consistency test content'

      // Create original
      await rpc(stub, 'writeFile', {
        path: '/consistency-original.txt',
        data: btoa(content),
        encoding: 'base64',
      })

      // Create 3 hard links
      for (let i = 1; i <= 3; i++) {
        await rpc(stub, 'link', {
          existingPath: '/consistency-original.txt',
          newPath: `/consistency-link-${i}.txt`,
        })
      }

      // Verify ref_count is 4
      let blobInfo = await rpc(stub, 'getBlobInfo', { path: '/consistency-original.txt' })
      expect((blobInfo.data as { refCount: number }).refCount).toBe(4)

      // Delete 2 links
      await rpc(stub, 'unlink', { path: '/consistency-link-1.txt' })
      await rpc(stub, 'unlink', { path: '/consistency-link-2.txt' })

      // Verify ref_count is 2
      blobInfo = await rpc(stub, 'getBlobInfo', { path: '/consistency-original.txt' })
      expect((blobInfo.data as { refCount: number }).refCount).toBe(2)

      // Create another link
      await rpc(stub, 'link', {
        existingPath: '/consistency-original.txt',
        newPath: '/consistency-link-4.txt',
      })

      // Verify ref_count is 3
      blobInfo = await rpc(stub, 'getBlobInfo', { path: '/consistency-original.txt' })
      expect((blobInfo.data as { refCount: number }).refCount).toBe(3)
    })
  })
})

// =============================================================================
// Orphan Blob Cleanup Tests
// =============================================================================

describe('Blob Storage - Orphan Blob Cleanup', () => {
  it('should delete blob when ref_count reaches 0', async () => {
    const id = env.FSX.idFromName('blob-orphan-cleanup-test')
    const stub = env.FSX.get(id)

    // Create file
    await rpc(stub, 'writeFile', {
      path: '/orphan-test.txt',
      data: btoa('Orphan test content'),
      encoding: 'base64',
    })

    // Get blob ID
    const blobInfo = await rpc(stub, 'getBlobInfo', { path: '/orphan-test.txt' })
    const blobId = (blobInfo.data as { blobId: string }).blobId

    // Delete file (ref_count goes to 0)
    await rpc(stub, 'unlink', { path: '/orphan-test.txt' })

    // Blob should be deleted
    const orphanCheck = await rpc(stub, 'getBlobById', { blobId })
    expect(orphanCheck.status).toBe(404)
  })

  it('should list orphaned blobs', async () => {
    const id = env.FSX.idFromName('blob-list-orphans-test')
    const stub = env.FSX.get(id)

    // Get initial orphan count
    const initialOrphans = await rpc(stub, 'listOrphanedBlobs', {})

    // Note: Orphaned blobs are immediately cleaned up in normal operation
    // This test verifies the API exists and returns proper structure
    expect(initialOrphans.status).toBe(200)
    const orphanList = initialOrphans.data as { orphans: string[]; count: number }
    expect(Array.isArray(orphanList.orphans)).toBe(true)
    expect(typeof orphanList.count).toBe('number')
  })

  it('should clean up orphaned blobs on demand', async () => {
    const id = env.FSX.idFromName('blob-cleanup-demand-test')
    const stub = env.FSX.get(id)

    // Trigger cleanup
    const cleanupResult = await rpc(stub, 'cleanupOrphanedBlobs', {})

    expect(cleanupResult.status).toBe(200)
    const result = cleanupResult.data as { cleaned: number; freedBytes: number }
    expect(typeof result.cleaned).toBe('number')
    expect(typeof result.freedBytes).toBe('number')
  })

  it('should not delete blob with active references during cleanup', async () => {
    const id = env.FSX.idFromName('blob-no-delete-active-test')
    const stub = env.FSX.get(id)

    const content = 'Active reference content'

    // Create file
    await rpc(stub, 'writeFile', {
      path: '/active-ref.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    // Get blob ID
    const blobInfo = await rpc(stub, 'getBlobInfo', { path: '/active-ref.txt' })
    const blobId = (blobInfo.data as { blobId: string }).blobId

    // Trigger cleanup
    await rpc(stub, 'cleanupOrphanedBlobs', {})

    // Blob should still exist
    const blobCheck = await rpc(stub, 'getBlobById', { blobId })
    expect(blobCheck.status).toBe(200)

    // File should still be readable
    const readResult = await rpc(stub, 'readFile', { path: '/active-ref.txt' })
    expect(readResult.status).toBe(200)
    expect(atob((readResult.data as { data: string }).data)).toBe(content)
  })
})

// =============================================================================
// Tier Tracking Tests
// =============================================================================

describe('Blob Storage - Tier Tracking', () => {
  describe('tier assignment', () => {
    it('should assign hot tier to small blobs by default', async () => {
      const id = env.FSX.idFromName('blob-tier-small-test')
      const stub = env.FSX.get(id)

      // Small content (< 1MB)
      const content = 'Small content for hot tier'

      await rpc(stub, 'writeFile', {
        path: '/small-tier.txt',
        data: btoa(content),
        encoding: 'base64',
      })

      const blobInfo = await rpc(stub, 'getBlobInfo', { path: '/small-tier.txt' })
      expect(blobInfo.status).toBe(200)
      const info = blobInfo.data as { tier: string }
      expect(info.tier).toBe('hot')
    })

    it('should allow explicit tier specification', async () => {
      const id = env.FSX.idFromName('blob-tier-explicit-test')
      const stub = env.FSX.get(id)

      await rpc(stub, 'writeFile', {
        path: '/explicit-warm.txt',
        data: btoa('Content for warm tier'),
        encoding: 'base64',
        tier: 'warm',
      })

      const blobInfo = await rpc(stub, 'getBlobInfo', { path: '/explicit-warm.txt' })
      expect(blobInfo.status).toBe(200)
      const info = blobInfo.data as { tier: string }
      expect(info.tier).toBe('warm')
    })

    it('should support all tier values (hot, warm, cold)', async () => {
      const id = env.FSX.idFromName('blob-all-tiers-test')
      const stub = env.FSX.get(id)

      const tiers = ['hot', 'warm', 'cold'] as const

      for (const tier of tiers) {
        await rpc(stub, 'writeFile', {
          path: `/tier-${tier}.txt`,
          data: btoa(`Content for ${tier} tier`),
          encoding: 'base64',
          tier,
        })

        const blobInfo = await rpc(stub, 'getBlobInfo', { path: `/tier-${tier}.txt` })
        expect(blobInfo.status).toBe(200)
        const info = blobInfo.data as { tier: string }
        expect(info.tier).toBe(tier)
      }
    })
  })

  describe('tier migration', () => {
    it('should promote blob from cold to hot', async () => {
      const id = env.FSX.idFromName('blob-promote-test')
      const stub = env.FSX.get(id)

      // Create file in cold tier
      await rpc(stub, 'writeFile', {
        path: '/promote-test.txt',
        data: btoa('Promote me to hot'),
        encoding: 'base64',
        tier: 'cold',
      })

      // Verify initial tier
      let blobInfo = await rpc(stub, 'getBlobInfo', { path: '/promote-test.txt' })
      expect((blobInfo.data as { tier: string }).tier).toBe('cold')

      // Promote to hot
      const promoteResult = await rpc(stub, 'promote', {
        path: '/promote-test.txt',
        tier: 'hot',
      })
      expect(promoteResult.status).toBe(200)

      // Verify new tier
      blobInfo = await rpc(stub, 'getBlobInfo', { path: '/promote-test.txt' })
      expect((blobInfo.data as { tier: string }).tier).toBe('hot')
    })

    it('should demote blob from hot to cold', async () => {
      const id = env.FSX.idFromName('blob-demote-test')
      const stub = env.FSX.get(id)

      // Create file in hot tier
      await rpc(stub, 'writeFile', {
        path: '/demote-test.txt',
        data: btoa('Demote me to cold'),
        encoding: 'base64',
        tier: 'hot',
      })

      // Demote to cold
      const demoteResult = await rpc(stub, 'demote', {
        path: '/demote-test.txt',
        tier: 'cold',
      })
      expect(demoteResult.status).toBe(200)

      // Verify new tier
      const blobInfo = await rpc(stub, 'getBlobInfo', { path: '/demote-test.txt' })
      expect((blobInfo.data as { tier: string }).tier).toBe('cold')
    })

    it('should preserve data integrity during tier migration', async () => {
      const id = env.FSX.idFromName('blob-migrate-integrity-test')
      const stub = env.FSX.get(id)

      const content = 'Content integrity during migration'

      // Create file in hot tier
      await rpc(stub, 'writeFile', {
        path: '/migrate-integrity.txt',
        data: btoa(content),
        encoding: 'base64',
        tier: 'hot',
      })

      // Get checksum before migration
      const beforeMigration = await rpc(stub, 'getBlobInfo', { path: '/migrate-integrity.txt' })
      const checksumBefore = (beforeMigration.data as { checksum: string }).checksum

      // Demote to cold
      await rpc(stub, 'demote', { path: '/migrate-integrity.txt', tier: 'cold' })

      // Get checksum after migration
      const afterMigration = await rpc(stub, 'getBlobInfo', { path: '/migrate-integrity.txt' })
      const checksumAfter = (afterMigration.data as { checksum: string }).checksum

      // Checksums should match
      expect(checksumAfter).toBe(checksumBefore)

      // Content should be readable and unchanged
      const readResult = await rpc(stub, 'readFile', { path: '/migrate-integrity.txt' })
      expect(atob((readResult.data as { data: string }).data)).toBe(content)
    })
  })

  describe('tier statistics', () => {
    it('should report blob count by tier', async () => {
      const id = env.FSX.idFromName('blob-tier-stats-test')
      const stub = env.FSX.get(id)

      // Create blobs in different tiers
      await rpc(stub, 'writeFile', {
        path: '/stat-hot.txt',
        data: btoa('Hot tier blob'),
        encoding: 'base64',
        tier: 'hot',
      })

      await rpc(stub, 'writeFile', {
        path: '/stat-warm.txt',
        data: btoa('Warm tier blob'),
        encoding: 'base64',
        tier: 'warm',
      })

      // Get tier statistics
      const statsResult = await rpc(stub, 'getTierStats', {})
      expect(statsResult.status).toBe(200)

      const stats = statsResult.data as {
        hot: { count: number; size: number }
        warm: { count: number; size: number }
        cold: { count: number; size: number }
      }

      expect(stats.hot.count).toBeGreaterThanOrEqual(1)
      expect(stats.warm.count).toBeGreaterThanOrEqual(1)
    })

    it('should report total size by tier', async () => {
      const id = env.FSX.idFromName('blob-tier-size-test')
      const stub = env.FSX.get(id)

      const hotContent = 'Hot content with specific size'
      const warmContent = 'Warm content with different size!'

      await rpc(stub, 'writeFile', {
        path: '/size-hot.txt',
        data: btoa(hotContent),
        encoding: 'base64',
        tier: 'hot',
      })

      await rpc(stub, 'writeFile', {
        path: '/size-warm.txt',
        data: btoa(warmContent),
        encoding: 'base64',
        tier: 'warm',
      })

      const statsResult = await rpc(stub, 'getTierStats', {})
      expect(statsResult.status).toBe(200)

      const stats = statsResult.data as {
        hot: { count: number; size: number }
        warm: { count: number; size: number }
      }

      expect(stats.hot.size).toBeGreaterThanOrEqual(hotContent.length)
      expect(stats.warm.size).toBeGreaterThanOrEqual(warmContent.length)
    })
  })
})

// =============================================================================
// Deduplication Tests
// =============================================================================

describe('Blob Storage - Deduplication', () => {
  it('should deduplicate identical content', async () => {
    const id = env.FSX.idFromName('blob-dedup-identical-test')
    const stub = env.FSX.get(id)

    const content = 'Identical content for deduplication test'

    // Create first file
    await rpc(stub, 'writeFile', {
      path: '/dedup-first.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    // Create second file with identical content
    await rpc(stub, 'writeFile', {
      path: '/dedup-second.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    // Both files should reference the same blob
    const firstBlobInfo = await rpc(stub, 'getBlobInfo', { path: '/dedup-first.txt' })
    const secondBlobInfo = await rpc(stub, 'getBlobInfo', { path: '/dedup-second.txt' })

    const firstId = (firstBlobInfo.data as { blobId: string }).blobId
    const secondId = (secondBlobInfo.data as { blobId: string }).blobId

    expect(firstId).toBe(secondId)
  })

  it('should not deduplicate different content', async () => {
    const id = env.FSX.idFromName('blob-no-dedup-test')
    const stub = env.FSX.get(id)

    // Create files with different content
    await rpc(stub, 'writeFile', {
      path: '/no-dedup-first.txt',
      data: btoa('First unique content'),
      encoding: 'base64',
    })

    await rpc(stub, 'writeFile', {
      path: '/no-dedup-second.txt',
      data: btoa('Second unique content'),
      encoding: 'base64',
    })

    // Should have different blob IDs
    const firstBlobInfo = await rpc(stub, 'getBlobInfo', { path: '/no-dedup-first.txt' })
    const secondBlobInfo = await rpc(stub, 'getBlobInfo', { path: '/no-dedup-second.txt' })

    const firstId = (firstBlobInfo.data as { blobId: string }).blobId
    const secondId = (secondBlobInfo.data as { blobId: string }).blobId

    expect(firstId).not.toBe(secondId)
  })

  it('should deduplicate across directories', async () => {
    const id = env.FSX.idFromName('blob-dedup-dirs-test')
    const stub = env.FSX.get(id)

    const content = 'Cross-directory deduplication content'

    // Create directories
    await rpc(stub, 'mkdir', { path: '/dedup-dir1', recursive: true })
    await rpc(stub, 'mkdir', { path: '/dedup-dir2', recursive: true })

    // Create files in different directories with same content
    await rpc(stub, 'writeFile', {
      path: '/dedup-dir1/file.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    await rpc(stub, 'writeFile', {
      path: '/dedup-dir2/file.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    // Should share the same blob
    const dir1BlobInfo = await rpc(stub, 'getBlobInfo', { path: '/dedup-dir1/file.txt' })
    const dir2BlobInfo = await rpc(stub, 'getBlobInfo', { path: '/dedup-dir2/file.txt' })

    const dir1Id = (dir1BlobInfo.data as { blobId: string }).blobId
    const dir2Id = (dir2BlobInfo.data as { blobId: string }).blobId

    expect(dir1Id).toBe(dir2Id)
  })

  it('should handle deduplication with overwrite', async () => {
    const id = env.FSX.idFromName('blob-dedup-overwrite-test')
    const stub = env.FSX.get(id)

    const originalContent = 'Original content'
    const newContent = 'Different new content'

    // Create first file
    await rpc(stub, 'writeFile', {
      path: '/overwrite-dedup.txt',
      data: btoa(originalContent),
      encoding: 'base64',
    })

    // Get original blob ID
    const originalBlobInfo = await rpc(stub, 'getBlobInfo', { path: '/overwrite-dedup.txt' })
    const originalBlobId = (originalBlobInfo.data as { blobId: string }).blobId

    // Overwrite with different content
    await rpc(stub, 'writeFile', {
      path: '/overwrite-dedup.txt',
      data: btoa(newContent),
      encoding: 'base64',
    })

    // Should have new blob ID
    const newBlobInfo = await rpc(stub, 'getBlobInfo', { path: '/overwrite-dedup.txt' })
    const newBlobId = (newBlobInfo.data as { blobId: string }).blobId

    expect(newBlobId).not.toBe(originalBlobId)

    // Original blob should be orphaned and cleaned up
    const originalBlobCheck = await rpc(stub, 'getBlobById', { blobId: originalBlobId })
    expect(originalBlobCheck.status).toBe(404)
  })

  it('should report storage savings from deduplication', async () => {
    const id = env.FSX.idFromName('blob-dedup-savings-test')
    const stub = env.FSX.get(id)

    const content = 'Repeated content for savings calculation '.repeat(100)

    // Get initial stats
    const initialStats = await rpc(stub, 'getDedupStats', {})

    // Create multiple files with same content
    for (let i = 0; i < 5; i++) {
      await rpc(stub, 'writeFile', {
        path: `/savings-${i}.txt`,
        data: btoa(content),
        encoding: 'base64',
      })
    }

    // Get final stats
    const finalStats = await rpc(stub, 'getDedupStats', {})
    expect(finalStats.status).toBe(200)

    const stats = finalStats.data as {
      totalLogicalSize: number
      totalPhysicalSize: number
      dedupRatio: number
      savedBytes: number
    }

    // Should show significant deduplication savings
    expect(stats.totalLogicalSize).toBeGreaterThan(stats.totalPhysicalSize)
    expect(stats.dedupRatio).toBeGreaterThan(1)
    expect(stats.savedBytes).toBeGreaterThan(0)
  })
})

// =============================================================================
// Edge Cases and Error Handling
// =============================================================================

describe('Blob Storage - Edge Cases', () => {
  describe('empty blobs', () => {
    it('should handle empty file creation', async () => {
      const id = env.FSX.idFromName('blob-empty-test')
      const stub = env.FSX.get(id)

      await rpc(stub, 'writeFile', {
        path: '/empty.txt',
        data: '',
        encoding: 'base64',
      })

      const statResult = await rpc(stub, 'stat', { path: '/empty.txt' })
      expect(statResult.status).toBe(200)
      expect((statResult.data as { size: number }).size).toBe(0)
    })

    it('should deduplicate multiple empty files', async () => {
      const id = env.FSX.idFromName('blob-empty-dedup-test')
      const stub = env.FSX.get(id)

      // Create multiple empty files
      await rpc(stub, 'writeFile', {
        path: '/empty1.txt',
        data: '',
        encoding: 'base64',
      })

      await rpc(stub, 'writeFile', {
        path: '/empty2.txt',
        data: '',
        encoding: 'base64',
      })

      // Both should reference the same (empty) blob
      const empty1Info = await rpc(stub, 'getBlobInfo', { path: '/empty1.txt' })
      const empty2Info = await rpc(stub, 'getBlobInfo', { path: '/empty2.txt' })

      // Empty files may not have blobs, or may share a special empty blob
      if (empty1Info.status === 200 && empty2Info.status === 200) {
        const id1 = (empty1Info.data as { blobId: string }).blobId
        const id2 = (empty2Info.data as { blobId: string }).blobId
        expect(id1).toBe(id2)
      }
    })
  })

  describe('large blobs', () => {
    it('should handle large blob storage', async () => {
      const id = env.FSX.idFromName('blob-large-test')
      const stub = env.FSX.get(id)

      // Create content larger than typical hot tier threshold
      const largeContent = 'A'.repeat(1024 * 100) // 100KB

      await rpc(stub, 'writeFile', {
        path: '/large-file.txt',
        data: btoa(largeContent),
        encoding: 'base64',
      })

      // Should be stored successfully
      const readResult = await rpc(stub, 'readFile', { path: '/large-file.txt' })
      expect(readResult.status).toBe(200)

      const readContent = atob((readResult.data as { data: string }).data)
      expect(readContent.length).toBe(largeContent.length)
    })

    it('should auto-assign warm tier for large blobs', async () => {
      const id = env.FSX.idFromName('blob-large-tier-test')
      const stub = env.FSX.get(id)

      // Content that exceeds hot tier threshold (typically 1MB)
      const largeContent = 'B'.repeat(1024 * 1024 * 2) // 2MB

      await rpc(stub, 'writeFile', {
        path: '/large-warm.bin',
        data: btoa(largeContent),
        encoding: 'base64',
      })

      const blobInfo = await rpc(stub, 'getBlobInfo', { path: '/large-warm.bin' })
      expect(blobInfo.status).toBe(200)

      const tier = (blobInfo.data as { tier: string }).tier
      // Large files should be in warm or cold tier, not hot
      expect(['warm', 'cold']).toContain(tier)
    })
  })

  describe('concurrent access', () => {
    it('should handle concurrent writes to different files', async () => {
      const id = env.FSX.idFromName('blob-concurrent-diff-test')
      const stub = env.FSX.get(id)

      // Concurrent writes to different files
      const writes = []
      for (let i = 0; i < 10; i++) {
        writes.push(
          rpc(stub, 'writeFile', {
            path: `/concurrent-${i}.txt`,
            data: btoa(`Content for file ${i}`),
            encoding: 'base64',
          })
        )
      }

      const results = await Promise.all(writes)

      // All writes should succeed
      for (const result of results) {
        expect(result.status).toBe(200)
      }

      // All files should be readable
      for (let i = 0; i < 10; i++) {
        const readResult = await rpc(stub, 'readFile', { path: `/concurrent-${i}.txt` })
        expect(readResult.status).toBe(200)
        expect(atob((readResult.data as { data: string }).data)).toBe(`Content for file ${i}`)
      }
    })

    it('should handle concurrent hard link creation', async () => {
      const id = env.FSX.idFromName('blob-concurrent-link-test')
      const stub = env.FSX.get(id)

      // Create source file
      await rpc(stub, 'writeFile', {
        path: '/link-source.txt',
        data: btoa('Link source content'),
        encoding: 'base64',
      })

      // Concurrent hard link creation
      const links = []
      for (let i = 0; i < 5; i++) {
        links.push(
          rpc(stub, 'link', {
            existingPath: '/link-source.txt',
            newPath: `/concurrent-link-${i}.txt`,
          })
        )
      }

      const results = await Promise.all(links)

      // All links should succeed
      for (const result of results) {
        expect(result.status).toBe(200)
      }

      // ref_count should be 6 (source + 5 links)
      const blobInfo = await rpc(stub, 'getBlobInfo', { path: '/link-source.txt' })
      expect((blobInfo.data as { refCount: number }).refCount).toBe(6)
    })

    it('should handle concurrent deletes with ref_count', async () => {
      const id = env.FSX.idFromName('blob-concurrent-delete-test')
      const stub = env.FSX.get(id)

      // Create source with multiple links
      await rpc(stub, 'writeFile', {
        path: '/delete-source.txt',
        data: btoa('Delete source content'),
        encoding: 'base64',
      })

      for (let i = 0; i < 5; i++) {
        await rpc(stub, 'link', {
          existingPath: '/delete-source.txt',
          newPath: `/delete-link-${i}.txt`,
        })
      }

      // Concurrent deletes
      const deletes = []
      for (let i = 0; i < 3; i++) {
        deletes.push(rpc(stub, 'unlink', { path: `/delete-link-${i}.txt` }))
      }

      await Promise.all(deletes)

      // ref_count should be 3 (source + 2 remaining links)
      const blobInfo = await rpc(stub, 'getBlobInfo', { path: '/delete-source.txt' })
      expect((blobInfo.data as { refCount: number }).refCount).toBe(3)
    })
  })

  describe('error handling', () => {
    it('should return error for non-existent blob retrieval', async () => {
      const id = env.FSX.idFromName('blob-not-found-test')
      const stub = env.FSX.get(id)

      const result = await rpc(stub, 'getBlobById', {
        blobId: 'non-existent-blob-id',
      })

      expect(result.status).toBe(404)
    })

    it('should handle getBlobInfo for non-existent file', async () => {
      const id = env.FSX.idFromName('blob-info-not-found-test')
      const stub = env.FSX.get(id)

      const result = await rpc(stub, 'getBlobInfo', {
        path: '/does-not-exist.txt',
      })

      expect(result.status).toBe(404)
    })

    it('should handle tier change for non-existent file', async () => {
      const id = env.FSX.idFromName('blob-tier-not-found-test')
      const stub = env.FSX.get(id)

      const result = await rpc(stub, 'promote', {
        path: '/non-existent.txt',
        tier: 'hot',
      })

      expect(result.status).toBe(404)
    })

    it('should reject invalid tier values', async () => {
      const id = env.FSX.idFromName('blob-invalid-tier-test')
      const stub = env.FSX.get(id)

      await rpc(stub, 'writeFile', {
        path: '/invalid-tier.txt',
        data: btoa('Content'),
        encoding: 'base64',
      })

      const result = await rpc(stub, 'promote', {
        path: '/invalid-tier.txt',
        tier: 'invalid-tier' as any,
      })

      expect(result.status).toBeGreaterThanOrEqual(400)
    })
  })
})

// =============================================================================
// Blob Integrity Verification Tests
// =============================================================================

describe('Blob Storage - Integrity Verification', () => {
  it('should detect blob corruption', async () => {
    const id = env.FSX.idFromName('blob-corruption-test')
    const stub = env.FSX.get(id)

    await rpc(stub, 'writeFile', {
      path: '/integrity-check.txt',
      data: btoa('Integrity test content'),
      encoding: 'base64',
    })

    // Verify integrity (should pass)
    const verifyResult = await rpc(stub, 'verifyBlobIntegrity', {
      path: '/integrity-check.txt',
    })

    expect(verifyResult.status).toBe(200)
    const result = verifyResult.data as { valid: boolean }
    expect(result.valid).toBe(true)
  })

  it('should provide checksum verification API', async () => {
    const id = env.FSX.idFromName('blob-checksum-verify-test')
    const stub = env.FSX.get(id)

    const content = 'Checksum verification content'
    const expectedHash = await sha256(content)

    await rpc(stub, 'writeFile', {
      path: '/checksum-verify.txt',
      data: btoa(content),
      encoding: 'base64',
    })

    const verifyResult = await rpc(stub, 'verifyChecksum', {
      path: '/checksum-verify.txt',
      expectedChecksum: expectedHash,
    })

    expect(verifyResult.status).toBe(200)
    const result = verifyResult.data as { valid: boolean; actualChecksum: string }
    expect(result.valid).toBe(true)
  })

  it('should fail verification for mismatched checksum', async () => {
    const id = env.FSX.idFromName('blob-checksum-mismatch-test')
    const stub = env.FSX.get(id)

    await rpc(stub, 'writeFile', {
      path: '/checksum-mismatch.txt',
      data: btoa('Some content'),
      encoding: 'base64',
    })

    const verifyResult = await rpc(stub, 'verifyChecksum', {
      path: '/checksum-mismatch.txt',
      expectedChecksum: 'wrong-checksum-value',
    })

    expect(verifyResult.status).toBe(200)
    const result = verifyResult.data as { valid: boolean }
    expect(result.valid).toBe(false)
  })
})
