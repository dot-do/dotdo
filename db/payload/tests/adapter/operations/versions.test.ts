import { describe, it, expect, beforeEach } from 'vitest'
import { createPayloadAdapterHarness } from '../../../src'
import type { PayloadAdapterHarness } from '../../../src'

/**
 * PayloadAdapter Versioning Operations Tests
 *
 * These tests verify the adapter's versioning operations, including:
 * - Creating version snapshots of documents
 * - Finding and retrieving versions
 * - Restoring documents to previous versions
 * - Deleting old versions
 * - Version metadata (who, type, labels)
 *
 * Reference: dotdo-pwys - A22 RED: Version operation tests
 */

// ============================================================================
// TEST FIXTURES
// ============================================================================

/** Sample document data for versioning tests */
const samplePost = {
  title: 'Original Title',
  slug: 'original-slug',
  content: 'Original content goes here',
  status: 'draft',
}

/** Updated document data for version comparison */
const updatedPost = {
  title: 'Updated Title',
  slug: 'updated-slug',
  content: 'Updated content goes here',
  status: 'published',
}

// ============================================================================
// VERSIONING OPERATIONS TESTS
// ============================================================================

describe('PayloadAdapter Versioning Operations', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
    })
  })

  // ==========================================================================
  // createVersion
  // ==========================================================================

  describe('createVersion', () => {
    it('should create version snapshot of document', async () => {
      const adapter = harness.adapter as any

      // Create a document first
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create a version snapshot
      const version = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      expect(version).toBeDefined()
      expect(version.id).toBeDefined()
      expect(version.parent).toBe(doc.id)
      expect(version.version?.title).toBe('Original Title')
      expect(version.version?.content).toBe('Original content goes here')
    })

    it('should assign incrementing version number', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create first version
      const version1 = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      // Update document
      await adapter.update({
        collection: 'posts',
        id: doc.id,
        data: { title: 'Modified Title' },
      })

      // Create second version
      const version2 = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      // Create third version
      const version3 = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      expect(version1.versionNumber).toBe(1)
      expect(version2.versionNumber).toBe(2)
      expect(version3.versionNumber).toBe(3)
    })

    it('should preserve document state at time of version', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version of original state
      const version1 = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      // Update the document multiple times
      await adapter.update({
        collection: 'posts',
        id: doc.id,
        data: { title: 'First Update', content: 'First update content' },
      })

      await adapter.update({
        collection: 'posts',
        id: doc.id,
        data: { title: 'Second Update', content: 'Second update content' },
      })

      // Version should still have original data
      expect(version1.version?.title).toBe('Original Title')
      expect(version1.version?.content).toBe('Original content goes here')
      expect(version1.version?.status).toBe('draft')
    })

    it('should set createdAt on version', async () => {
      const adapter = harness.adapter as any
      const before = new Date()

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version
      const version = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      const after = new Date()

      expect(version.createdAt).toBeDefined()
      const versionCreatedAt = new Date(version.createdAt)
      expect(versionCreatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(versionCreatedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should link version to parent document', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version
      const version = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      // Version should reference parent document
      expect(version.parent).toBe(doc.id)

      // Should be able to find the parent from version
      const parent = await adapter.findOne({
        collection: 'posts',
        id: version.parent,
      })

      expect(parent).toBeDefined()
      expect(parent.id).toBe(doc.id)
    })
  })

  // ==========================================================================
  // findVersions
  // ==========================================================================

  describe('findVersions', () => {
    it('should return all versions of a document', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create multiple versions
      await adapter.createVersion({ collection: 'posts', id: doc.id })
      await adapter.update({ collection: 'posts', id: doc.id, data: { title: 'Update 1' } })
      await adapter.createVersion({ collection: 'posts', id: doc.id })
      await adapter.update({ collection: 'posts', id: doc.id, data: { title: 'Update 2' } })
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Find all versions
      const result = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
      })

      expect(result.docs).toHaveLength(3)
      expect(result.totalDocs).toBe(3)
    })

    it('should sort versions by version number', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create multiple versions
      await adapter.createVersion({ collection: 'posts', id: doc.id })
      await adapter.update({ collection: 'posts', id: doc.id, data: { title: 'Update 1' } })
      await adapter.createVersion({ collection: 'posts', id: doc.id })
      await adapter.update({ collection: 'posts', id: doc.id, data: { title: 'Update 2' } })
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Find versions sorted by version number (descending by default)
      const result = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
        sort: '-versionNumber',
      })

      expect(result.docs[0].versionNumber).toBe(3)
      expect(result.docs[1].versionNumber).toBe(2)
      expect(result.docs[2].versionNumber).toBe(1)

      // Find versions sorted ascending
      const resultAsc = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
        sort: 'versionNumber',
      })

      expect(resultAsc.docs[0].versionNumber).toBe(1)
      expect(resultAsc.docs[1].versionNumber).toBe(2)
      expect(resultAsc.docs[2].versionNumber).toBe(3)
    })

    it('should support pagination', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create 5 versions
      for (let i = 0; i < 5; i++) {
        await adapter.createVersion({ collection: 'posts', id: doc.id })
        if (i < 4) {
          await adapter.update({ collection: 'posts', id: doc.id, data: { title: `Update ${i + 1}` } })
        }
      }

      // Get first page with limit 2
      const page1 = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
        limit: 2,
        page: 1,
      })

      expect(page1.docs).toHaveLength(2)
      expect(page1.totalDocs).toBe(5)
      expect(page1.totalPages).toBe(3)
      expect(page1.hasNextPage).toBe(true)
      expect(page1.hasPrevPage).toBe(false)

      // Get second page
      const page2 = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
        limit: 2,
        page: 2,
      })

      expect(page2.docs).toHaveLength(2)
      expect(page2.hasNextPage).toBe(true)
      expect(page2.hasPrevPage).toBe(true)

      // Get third page (last)
      const page3 = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
        limit: 2,
        page: 3,
      })

      expect(page3.docs).toHaveLength(1)
      expect(page3.hasNextPage).toBe(false)
      expect(page3.hasPrevPage).toBe(true)
    })

    it('should filter by parent document', async () => {
      const adapter = harness.adapter as any

      // Create two documents
      const doc1 = await adapter.create({
        collection: 'posts',
        data: { ...samplePost, title: 'Document 1' },
      })

      const doc2 = await adapter.create({
        collection: 'posts',
        data: { ...samplePost, title: 'Document 2' },
      })

      // Create versions for both
      await adapter.createVersion({ collection: 'posts', id: doc1.id })
      await adapter.createVersion({ collection: 'posts', id: doc1.id })
      await adapter.createVersion({ collection: 'posts', id: doc2.id })

      // Find versions only for doc1
      const doc1Versions = await adapter.findVersions({
        collection: 'posts',
        id: doc1.id,
      })

      expect(doc1Versions.docs).toHaveLength(2)
      expect(doc1Versions.docs.every((v: any) => v.parent === doc1.id)).toBe(true)

      // Find versions only for doc2
      const doc2Versions = await adapter.findVersions({
        collection: 'posts',
        id: doc2.id,
      })

      expect(doc2Versions.docs).toHaveLength(1)
      expect(doc2Versions.docs.every((v: any) => v.parent === doc2.id)).toBe(true)
    })
  })

  // ==========================================================================
  // findVersion
  // ==========================================================================

  describe('findVersion', () => {
    it('should return specific version by number', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create multiple versions with different content
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      await adapter.update({ collection: 'posts', id: doc.id, data: { title: 'Version 2 Title' } })
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      await adapter.update({ collection: 'posts', id: doc.id, data: { title: 'Version 3 Title' } })
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Find specific version by number
      const version2 = await adapter.findVersion({
        collection: 'posts',
        id: doc.id,
        versionNumber: 2,
      })

      expect(version2).toBeDefined()
      expect(version2.versionNumber).toBe(2)
      expect(version2.version?.title).toBe('Version 2 Title')
    })

    it('should return null for non-existent version', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create one version
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Try to find non-existent version
      const result = await adapter.findVersion({
        collection: 'posts',
        id: doc.id,
        versionNumber: 999,
      })

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // restoreVersion
  // ==========================================================================

  describe('restoreVersion', () => {
    it('should restore document to specific version', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version of original state
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Update the document
      await adapter.update({
        collection: 'posts',
        id: doc.id,
        data: updatedPost,
      })

      // Verify current state is updated
      const currentDoc = await adapter.findOne({ collection: 'posts', id: doc.id })
      expect(currentDoc.title).toBe('Updated Title')
      expect(currentDoc.content).toBe('Updated content goes here')

      // Restore to version 1
      await adapter.restoreVersion({
        collection: 'posts',
        id: doc.id,
        versionNumber: 1,
      })

      // Verify document is restored
      const restoredDoc = await adapter.findOne({ collection: 'posts', id: doc.id })
      expect(restoredDoc.title).toBe('Original Title')
      expect(restoredDoc.content).toBe('Original content goes here')
      expect(restoredDoc.status).toBe('draft')
    })

    it('should create new version on restore', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version 1
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Update and create version 2
      await adapter.update({ collection: 'posts', id: doc.id, data: { title: 'Update 1' } })
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Check we have 2 versions
      const beforeRestore = await adapter.findVersions({ collection: 'posts', id: doc.id })
      expect(beforeRestore.totalDocs).toBe(2)

      // Restore to version 1 (should create version 3)
      await adapter.restoreVersion({
        collection: 'posts',
        id: doc.id,
        versionNumber: 1,
      })

      // Check we now have 3 versions
      const afterRestore = await adapter.findVersions({ collection: 'posts', id: doc.id })
      expect(afterRestore.totalDocs).toBe(3)

      // Version 3 should be the restored version
      const version3 = await adapter.findVersion({
        collection: 'posts',
        id: doc.id,
        versionNumber: 3,
      })
      expect(version3.version?.title).toBe('Original Title')
    })

    it('should update document with version data', async () => {
      const adapter = harness.adapter as any

      // Create a document with full data
      const doc = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Original Title',
          slug: 'original-slug',
          content: 'Original content',
          status: 'draft',
          views: 100,
          featured: false,
        },
      })

      // Create version of original state
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Update all fields
      await adapter.update({
        collection: 'posts',
        id: doc.id,
        data: {
          title: 'New Title',
          slug: 'new-slug',
          content: 'New content',
          status: 'published',
          views: 500,
          featured: true,
        },
      })

      // Restore to version 1
      const restored = await adapter.restoreVersion({
        collection: 'posts',
        id: doc.id,
        versionNumber: 1,
      })

      // All fields should be restored
      expect(restored.title).toBe('Original Title')
      expect(restored.slug).toBe('original-slug')
      expect(restored.content).toBe('Original content')
      expect(restored.status).toBe('draft')
      expect(restored.views).toBe(100)
      expect(restored.featured).toBe(false)
    })
  })

  // ==========================================================================
  // deleteVersions
  // ==========================================================================

  describe('deleteVersions', () => {
    it('should delete versions older than specified', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create 5 versions
      for (let i = 0; i < 5; i++) {
        await adapter.createVersion({ collection: 'posts', id: doc.id })
        if (i < 4) {
          await adapter.update({ collection: 'posts', id: doc.id, data: { title: `Update ${i + 1}` } })
        }
      }

      // Delete versions older than version 3 (should delete versions 1 and 2)
      await adapter.deleteVersions({
        collection: 'posts',
        id: doc.id,
        olderThan: 3,
      })

      // Check remaining versions
      const remaining = await adapter.findVersions({ collection: 'posts', id: doc.id })
      expect(remaining.totalDocs).toBe(3)
      expect(remaining.docs.every((v: any) => v.versionNumber >= 3)).toBe(true)
    })

    it('should keep minimum number of versions', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create 5 versions
      for (let i = 0; i < 5; i++) {
        await adapter.createVersion({ collection: 'posts', id: doc.id })
        if (i < 4) {
          await adapter.update({ collection: 'posts', id: doc.id, data: { title: `Update ${i + 1}` } })
        }
      }

      // Try to delete all versions but keep minimum of 2
      await adapter.deleteVersions({
        collection: 'posts',
        id: doc.id,
        keepMinimum: 2,
      })

      // Should have exactly 2 versions remaining (most recent)
      const remaining = await adapter.findVersions({ collection: 'posts', id: doc.id })
      expect(remaining.totalDocs).toBe(2)
      expect(remaining.docs.some((v: any) => v.versionNumber === 5)).toBe(true)
      expect(remaining.docs.some((v: any) => v.versionNumber === 4)).toBe(true)
    })

    it('should delete all versions of deleted document', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create versions
      await adapter.createVersion({ collection: 'posts', id: doc.id })
      await adapter.createVersion({ collection: 'posts', id: doc.id })
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Verify versions exist
      const beforeDelete = await adapter.findVersions({ collection: 'posts', id: doc.id })
      expect(beforeDelete.totalDocs).toBe(3)

      // Delete the document
      await adapter.delete({ collection: 'posts', id: doc.id })

      // Versions should also be deleted
      const afterDelete = await adapter.findVersions({ collection: 'posts', id: doc.id })
      expect(afterDelete.totalDocs).toBe(0)
    })
  })

  // ==========================================================================
  // version metadata
  // ==========================================================================

  describe('version metadata', () => {
    it('should track who created the version', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version with user info
      const version = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
        autosave: false,
        createdBy: 'user-123',
      })

      expect(version.createdBy).toBe('user-123')

      // Create another version by different user
      const version2 = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
        createdBy: 'user-456',
      })

      expect(version2.createdBy).toBe('user-456')
    })

    it('should track version type (draft, published)', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create draft version
      const draftVersion = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
        type: 'draft',
      })

      expect(draftVersion.type).toBe('draft')

      // Update and create published version
      await adapter.update({
        collection: 'posts',
        id: doc.id,
        data: { status: 'published' },
      })

      const publishedVersion = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
        type: 'published',
      })

      expect(publishedVersion.type).toBe('published')

      // Find only published versions
      const publishedVersions = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
        where: { type: { equals: 'published' } },
      })

      expect(publishedVersions.docs.every((v: any) => v.type === 'published')).toBe(true)
    })

    it('should support version labels', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version with label
      const labeledVersion = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
        label: 'v1.0 Release',
      })

      expect(labeledVersion.label).toBe('v1.0 Release')

      // Create another labeled version
      const labeledVersion2 = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
        label: 'Pre-launch snapshot',
      })

      expect(labeledVersion2.label).toBe('Pre-launch snapshot')

      // Find version by label
      const found = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
        where: { label: { equals: 'v1.0 Release' } },
      })

      expect(found.docs).toHaveLength(1)
      expect(found.docs[0].label).toBe('v1.0 Release')
    })
  })

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('edge cases', () => {
    it('should throw error when creating version for non-existent document', async () => {
      const adapter = harness.adapter as any

      await expect(
        adapter.createVersion({
          collection: 'posts',
          id: 'non-existent-id',
        })
      ).rejects.toThrow(/not found|does not exist/i)
    })

    it('should throw error when restoring non-existent version', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create one version
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Try to restore non-existent version
      await expect(
        adapter.restoreVersion({
          collection: 'posts',
          id: doc.id,
          versionNumber: 999,
        })
      ).rejects.toThrow(/version.*not found|does not exist/i)
    })

    it('should handle empty versions list gracefully', async () => {
      const adapter = harness.adapter as any

      // Create a document without any versions
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Find versions should return empty list
      const result = await adapter.findVersions({
        collection: 'posts',
        id: doc.id,
      })

      expect(result.docs).toHaveLength(0)
      expect(result.totalDocs).toBe(0)
    })

    it('should preserve version immutability', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version
      const version = await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      // Try to update a version (should fail or be ignored)
      await expect(
        adapter.updateVersion?.({
          collection: 'posts',
          versionId: version.id,
          data: { 'version.title': 'Hacked Title' },
        })
      ).rejects.toThrow(/immutable|cannot.*update.*version/i)

      // Version should remain unchanged
      const unchangedVersion = await adapter.findVersion({
        collection: 'posts',
        id: doc.id,
        versionNumber: 1,
      })

      expect(unchangedVersion.version?.title).toBe('Original Title')
    })
  })

  // ==========================================================================
  // Operation Tracking
  // ==========================================================================

  describe('operation tracking', () => {
    it('should track createVersion operations', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version
      await adapter.createVersion({
        collection: 'posts',
        id: doc.id,
      })

      // Check operation was tracked
      const versionOps = harness.operations.filter((op) => op.type === 'createVersion' as any)
      expect(versionOps.length).toBeGreaterThan(0)
    })

    it('should track restoreVersion operations', async () => {
      const adapter = harness.adapter as any

      // Create a document
      const doc = await adapter.create({
        collection: 'posts',
        data: samplePost,
      })

      // Create version
      await adapter.createVersion({ collection: 'posts', id: doc.id })

      // Restore version
      await adapter.restoreVersion({
        collection: 'posts',
        id: doc.id,
        versionNumber: 1,
      })

      // Check operation was tracked
      const restoreOps = harness.operations.filter((op) => op.type === 'restoreVersion' as any)
      expect(restoreOps.length).toBeGreaterThan(0)
    })
  })
})
