import { describe, it, expect, beforeEach } from 'vitest'
import {
  DocumentVersionManager,
  createDocumentVersionManager,
  type DocumentVersion,
  type VersionMetadata,
  type VersionDiff,
  type DocumentVersionStorage,
} from '../versioning'

/**
 * Document Versioning Tests
 *
 * Tests for tracking document changes over time with:
 * - Version creation with automatic numbering
 * - Version retrieval (specific version, latest, list all)
 * - Version revert functionality
 * - Version diff generation
 *
 * Reference: dotdo-5v42l - Document versioning implementation
 */

// ============================================================================
// TEST FIXTURES
// ============================================================================

/** Sample document content for testing */
const sampleContent = {
  title: 'Original Document',
  body: 'This is the original content.',
  tags: ['draft'],
}

/** Updated document content */
const updatedContent = {
  title: 'Updated Document',
  body: 'This is the updated content with changes.',
  tags: ['draft', 'reviewed'],
}

/** Second update content */
const secondUpdateContent = {
  title: 'Final Document',
  body: 'This is the final version.',
  tags: ['published'],
}

// ============================================================================
// VERSION CREATION TESTS
// ============================================================================

describe('DocumentVersionManager', () => {
  let manager: DocumentVersionManager

  beforeEach(() => {
    manager = createDocumentVersionManager()
  })

  // ==========================================================================
  // createVersion
  // ==========================================================================

  describe('createVersion', () => {
    it('should create first version with version number 1', async () => {
      const version = await manager.createVersion('doc-1', sampleContent, {
        author: 'user-123',
        message: 'Initial version',
      })

      expect(version).toBeDefined()
      expect(version.docId).toBe('doc-1')
      expect(version.version).toBe(1)
      expect(version.content).toEqual(sampleContent)
      expect(version.metadata?.author).toBe('user-123')
      expect(version.metadata?.message).toBe('Initial version')
    })

    it('should increment version number automatically', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)
      const version3 = await manager.createVersion('doc-1', secondUpdateContent)

      expect(version3.version).toBe(3)
    })

    it('should set createdAt timestamp', async () => {
      const before = new Date()
      const version = await manager.createVersion('doc-1', sampleContent)
      const after = new Date()

      expect(version.createdAt).toBeDefined()
      expect(version.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(version.createdAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should generate unique version ID', async () => {
      const version1 = await manager.createVersion('doc-1', sampleContent)
      const version2 = await manager.createVersion('doc-1', updatedContent)

      expect(version1.id).toBeDefined()
      expect(version2.id).toBeDefined()
      expect(version1.id).not.toBe(version2.id)
    })

    it('should store content as immutable snapshot', async () => {
      const mutableContent = { title: 'Mutable', body: 'Content' }
      const version = await manager.createVersion('doc-1', mutableContent)

      // Mutate the original content
      mutableContent.title = 'Changed'

      // Version should have original content
      expect(version.content.title).toBe('Mutable')
    })

    it('should support optional metadata', async () => {
      const versionWithMeta = await manager.createVersion('doc-1', sampleContent, {
        author: 'user-123',
        message: 'With metadata',
        labels: ['important', 'reviewed'],
      })

      const versionWithoutMeta = await manager.createVersion('doc-2', sampleContent)

      expect(versionWithMeta.metadata?.labels).toEqual(['important', 'reviewed'])
      expect(versionWithoutMeta.metadata).toBeUndefined()
    })

    it('should track versions separately per document', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)
      const doc1Version3 = await manager.createVersion('doc-1', secondUpdateContent)

      const doc2Version1 = await manager.createVersion('doc-2', sampleContent)

      expect(doc1Version3.version).toBe(3)
      expect(doc2Version1.version).toBe(1)
    })
  })

  // ==========================================================================
  // getVersion
  // ==========================================================================

  describe('getVersion', () => {
    it('should retrieve specific version by number', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)
      await manager.createVersion('doc-1', secondUpdateContent)

      const version2 = await manager.getVersion('doc-1', 2)

      expect(version2).toBeDefined()
      expect(version2?.version).toBe(2)
      expect(version2?.content).toEqual(updatedContent)
    })

    it('should return null for non-existent version', async () => {
      await manager.createVersion('doc-1', sampleContent)

      const result = await manager.getVersion('doc-1', 999)

      expect(result).toBeNull()
    })

    it('should return null for non-existent document', async () => {
      const result = await manager.getVersion('non-existent', 1)

      expect(result).toBeNull()
    })

    it('should preserve original content in retrieved version', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)

      const version1 = await manager.getVersion('doc-1', 1)

      expect(version1?.content).toEqual(sampleContent)
    })
  })

  // ==========================================================================
  // getLatest
  // ==========================================================================

  describe('getLatest', () => {
    it('should return most recent version', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)
      await manager.createVersion('doc-1', secondUpdateContent)

      const latest = await manager.getLatest('doc-1')

      expect(latest).toBeDefined()
      expect(latest?.version).toBe(3)
      expect(latest?.content).toEqual(secondUpdateContent)
    })

    it('should return null for document with no versions', async () => {
      const result = await manager.getLatest('non-existent')

      expect(result).toBeNull()
    })

    it('should return first version when only one exists', async () => {
      await manager.createVersion('doc-1', sampleContent)

      const latest = await manager.getLatest('doc-1')

      expect(latest?.version).toBe(1)
    })
  })

  // ==========================================================================
  // listVersions
  // ==========================================================================

  describe('listVersions', () => {
    it('should return all versions in order', async () => {
      await manager.createVersion('doc-1', sampleContent, { message: 'v1' })
      await manager.createVersion('doc-1', updatedContent, { message: 'v2' })
      await manager.createVersion('doc-1', secondUpdateContent, { message: 'v3' })

      const versions = await manager.listVersions('doc-1')

      expect(versions).toHaveLength(3)
      expect(versions[0].version).toBe(1)
      expect(versions[1].version).toBe(2)
      expect(versions[2].version).toBe(3)
    })

    it('should return empty array for document with no versions', async () => {
      const versions = await manager.listVersions('non-existent')

      expect(versions).toEqual([])
    })

    it('should support descending order', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)
      await manager.createVersion('doc-1', secondUpdateContent)

      const versions = await manager.listVersions('doc-1', { order: 'desc' })

      expect(versions[0].version).toBe(3)
      expect(versions[1].version).toBe(2)
      expect(versions[2].version).toBe(1)
    })

    it('should support pagination with limit', async () => {
      for (let i = 0; i < 10; i++) {
        await manager.createVersion('doc-1', { index: i })
      }

      const versions = await manager.listVersions('doc-1', { limit: 5 })

      expect(versions).toHaveLength(5)
    })

    it('should support pagination with offset', async () => {
      for (let i = 0; i < 10; i++) {
        await manager.createVersion('doc-1', { index: i })
      }

      const versions = await manager.listVersions('doc-1', { offset: 5, limit: 5 })

      expect(versions).toHaveLength(5)
      expect(versions[0].version).toBe(6)
    })

    it('should only return versions for specified document', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)
      await manager.createVersion('doc-2', sampleContent)

      const doc1Versions = await manager.listVersions('doc-1')
      const doc2Versions = await manager.listVersions('doc-2')

      expect(doc1Versions).toHaveLength(2)
      expect(doc2Versions).toHaveLength(1)
    })
  })

  // ==========================================================================
  // revert
  // ==========================================================================

  describe('revert', () => {
    it('should create new version with old content', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)
      await manager.createVersion('doc-1', secondUpdateContent)

      const reverted = await manager.revert('doc-1', 1)

      expect(reverted.version).toBe(4)
      expect(reverted.content).toEqual(sampleContent)
    })

    it('should set revertedFrom metadata', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)

      const reverted = await manager.revert('doc-1', 1)

      expect(reverted.metadata?.revertedFrom).toBe(1)
    })

    it('should throw error for non-existent version', async () => {
      await manager.createVersion('doc-1', sampleContent)

      await expect(manager.revert('doc-1', 999)).rejects.toThrow(/version.*not found/i)
    })

    it('should throw error for non-existent document', async () => {
      await expect(manager.revert('non-existent', 1)).rejects.toThrow(/document.*not found|version.*not found/i)
    })

    it('should preserve metadata from original version', async () => {
      await manager.createVersion('doc-1', sampleContent, {
        author: 'user-123',
        labels: ['original'],
      })
      await manager.createVersion('doc-1', updatedContent)

      const reverted = await manager.revert('doc-1', 1, { author: 'user-456' })

      expect(reverted.metadata?.author).toBe('user-456')
      expect(reverted.metadata?.revertedFrom).toBe(1)
    })

    it('should update latest version after revert', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)

      await manager.revert('doc-1', 1)
      const latest = await manager.getLatest('doc-1')

      expect(latest?.version).toBe(3)
      expect(latest?.content).toEqual(sampleContent)
    })
  })

  // ==========================================================================
  // diff
  // ==========================================================================

  describe('diff', () => {
    it('should generate diff between two versions', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)

      const diff = await manager.diff('doc-1', 1, 2)

      expect(diff).toBeDefined()
      expect(diff.docId).toBe('doc-1')
      expect(diff.fromVersion).toBe(1)
      expect(diff.toVersion).toBe(2)
      expect(diff.changes).toBeDefined()
    })

    it('should detect added fields', async () => {
      await manager.createVersion('doc-1', { title: 'Original' })
      await manager.createVersion('doc-1', { title: 'Original', body: 'Added field' })

      const diff = await manager.diff('doc-1', 1, 2)

      expect(diff.changes).toContainEqual({
        type: 'added',
        path: 'body',
        newValue: 'Added field',
      })
    })

    it('should detect removed fields', async () => {
      await manager.createVersion('doc-1', { title: 'Original', body: 'Will be removed' })
      await manager.createVersion('doc-1', { title: 'Original' })

      const diff = await manager.diff('doc-1', 1, 2)

      expect(diff.changes).toContainEqual({
        type: 'removed',
        path: 'body',
        oldValue: 'Will be removed',
      })
    })

    it('should detect modified fields', async () => {
      await manager.createVersion('doc-1', { title: 'Original Title' })
      await manager.createVersion('doc-1', { title: 'Updated Title' })

      const diff = await manager.diff('doc-1', 1, 2)

      expect(diff.changes).toContainEqual({
        type: 'modified',
        path: 'title',
        oldValue: 'Original Title',
        newValue: 'Updated Title',
      })
    })

    it('should detect changes in nested objects', async () => {
      await manager.createVersion('doc-1', {
        metadata: { author: 'John', status: 'draft' },
      })
      await manager.createVersion('doc-1', {
        metadata: { author: 'John', status: 'published' },
      })

      const diff = await manager.diff('doc-1', 1, 2)

      expect(diff.changes).toContainEqual({
        type: 'modified',
        path: 'metadata.status',
        oldValue: 'draft',
        newValue: 'published',
      })
    })

    it('should detect changes in arrays', async () => {
      await manager.createVersion('doc-1', { tags: ['a', 'b'] })
      await manager.createVersion('doc-1', { tags: ['a', 'b', 'c'] })

      const diff = await manager.diff('doc-1', 1, 2)

      // Array changes should be detected
      expect(diff.changes.some((c) => c.path.startsWith('tags'))).toBe(true)
    })

    it('should return empty changes for identical versions', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', sampleContent)

      const diff = await manager.diff('doc-1', 1, 2)

      expect(diff.changes).toHaveLength(0)
    })

    it('should throw error for non-existent from version', async () => {
      await manager.createVersion('doc-1', sampleContent)

      await expect(manager.diff('doc-1', 999, 1)).rejects.toThrow(/version.*not found/i)
    })

    it('should throw error for non-existent to version', async () => {
      await manager.createVersion('doc-1', sampleContent)

      await expect(manager.diff('doc-1', 1, 999)).rejects.toThrow(/version.*not found/i)
    })

    it('should support reverse diff (higher to lower version)', async () => {
      await manager.createVersion('doc-1', { title: 'Original' })
      await manager.createVersion('doc-1', { title: 'Updated' })

      const diff = await manager.diff('doc-1', 2, 1)

      expect(diff.fromVersion).toBe(2)
      expect(diff.toVersion).toBe(1)
      expect(diff.changes).toContainEqual({
        type: 'modified',
        path: 'title',
        oldValue: 'Updated',
        newValue: 'Original',
      })
    })
  })

  // ==========================================================================
  // Custom Storage Backend
  // ==========================================================================

  describe('custom storage backend', () => {
    it('should accept custom storage implementation', async () => {
      const storage: DocumentVersionStorage = {
        versions: new Map(),

        async save(version: DocumentVersion): Promise<void> {
          const docVersions = this.versions.get(version.docId) || []
          docVersions.push(version)
          this.versions.set(version.docId, docVersions)
        },

        async get(docId: string, version: number): Promise<DocumentVersion | null> {
          const docVersions = this.versions.get(docId) || []
          return docVersions.find((v) => v.version === version) ?? null
        },

        async getLatest(docId: string): Promise<DocumentVersion | null> {
          const docVersions = this.versions.get(docId) || []
          if (docVersions.length === 0) return null
          return docVersions[docVersions.length - 1]
        },

        async list(docId: string): Promise<DocumentVersion[]> {
          return this.versions.get(docId) || []
        },

        async getNextVersion(docId: string): Promise<number> {
          const docVersions = this.versions.get(docId) || []
          return docVersions.length + 1
        },
      }

      const customManager = createDocumentVersionManager({ storage })

      await customManager.createVersion('doc-1', sampleContent)
      const version = await customManager.getVersion('doc-1', 1)

      expect(version).toBeDefined()
      expect(version?.content).toEqual(sampleContent)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty content', async () => {
      const version = await manager.createVersion('doc-1', {})

      expect(version.content).toEqual({})
    })

    it('should handle null values in content', async () => {
      const version = await manager.createVersion('doc-1', {
        title: 'Title',
        description: null,
      })

      expect(version.content.description).toBeNull()
    })

    it('should handle special characters in document ID', async () => {
      const version = await manager.createVersion('doc/with/slashes', sampleContent)

      expect(version.docId).toBe('doc/with/slashes')

      const retrieved = await manager.getVersion('doc/with/slashes', 1)
      expect(retrieved).toBeDefined()
    })

    it('should handle unicode content', async () => {
      const unicodeContent = {
        title: 'Titre en francais',
        body: 'Contenu avec des caracteres speciaux et des emojis',
      }

      const version = await manager.createVersion('doc-1', unicodeContent)

      expect(version.content).toEqual(unicodeContent)
    })

    it('should handle large content', async () => {
      const largeContent = {
        data: 'x'.repeat(100000),
        array: Array(1000).fill('item'),
      }

      const version = await manager.createVersion('doc-1', largeContent)
      const retrieved = await manager.getVersion('doc-1', 1)

      expect(retrieved?.content.data.length).toBe(100000)
      expect(retrieved?.content.array.length).toBe(1000)
    })

    it('should handle concurrent version creation', async () => {
      // Create multiple versions concurrently
      const promises = Array(10)
        .fill(null)
        .map((_, i) => manager.createVersion('doc-1', { index: i }))

      const versions = await Promise.all(promises)

      // All versions should have unique numbers
      const versionNumbers = versions.map((v) => v.version).sort((a, b) => a - b)
      expect(versionNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    })
  })

  // ==========================================================================
  // Version Count / Statistics
  // ==========================================================================

  describe('version statistics', () => {
    it('should track version count per document', async () => {
      await manager.createVersion('doc-1', sampleContent)
      await manager.createVersion('doc-1', updatedContent)
      await manager.createVersion('doc-2', sampleContent)

      const doc1Versions = await manager.listVersions('doc-1')
      const doc2Versions = await manager.listVersions('doc-2')

      expect(doc1Versions.length).toBe(2)
      expect(doc2Versions.length).toBe(1)
    })
  })
})
