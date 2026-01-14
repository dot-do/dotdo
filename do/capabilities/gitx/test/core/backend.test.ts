/**
 * @fileoverview RED Phase Tests for GitBackend Interface
 *
 * These tests define the expected behavior for the GitBackend storage abstraction.
 * All tests should FAIL initially, then be made to pass during the GREEN phase.
 *
 * Tests cover:
 * 1. GitBackend interface definition
 * 2. readObject(sha: string): Promise<GitObject | null>
 * 3. writeObject(obj: GitObject): Promise<string> (returns SHA)
 * 4. hasObject(sha: string): Promise<boolean>
 * 5. readRef(name: string): Promise<string | null>
 * 6. writeRef(name: string, sha: string): Promise<void>
 * 7. deleteRef(name: string): Promise<void>
 * 8. listRefs(prefix?: string): Promise<Ref[]>
 * 9. readPackedRefs(): Promise<PackedRefs>
 * 10. writePackfile(pack: Uint8Array): Promise<void>
 * 11. MemoryBackend implementation for testing
 * 12. Backend isolation (multiple instances don't share state)
 *
 * @module test/core/backend
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type {
  GitBackend,
  MemoryBackend,
  Ref,
  PackedRefs,
} from '../../src/core/backend'
import {
  createMemoryBackend,
} from '../../src/core/backend'
import type { GitObject, BlobObject, TreeObject, CommitObject, TagObject, ObjectType } from '../../src/types/objects'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Helper function to compute expected SHA-1 hash for a Git object.
 * Git format: "{type} {size}\0{content}"
 */
async function computeObjectSha(type: ObjectType, data: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`${type} ${data.length}\0`)
  const fullData = new Uint8Array(header.length + data.length)
  fullData.set(header)
  fullData.set(data, header.length)
  const hashBuffer = await crypto.subtle.digest('SHA-1', fullData)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Helper to create text content as Uint8Array.
 */
function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * Create a test blob object.
 */
function createTestBlob(content: string): BlobObject {
  return {
    type: 'blob',
    data: textToBytes(content),
  }
}

/**
 * Create a test commit object.
 */
function createTestCommit(treeSha: string, message: string, parents: string[] = []): CommitObject {
  const author = {
    name: 'Test User',
    email: 'test@example.com.ai',
    timestamp: 1704067200,
    timezone: '+0000',
  }
  return {
    type: 'commit',
    data: textToBytes(`tree ${treeSha}\nauthor Test User <test@example.com.ai> 1704067200 +0000\ncommitter Test User <test@example.com.ai> 1704067200 +0000\n\n${message}`),
    tree: treeSha,
    parents,
    author,
    committer: author,
    message,
  }
}

// ============================================================================
// GitBackend Interface Tests
// ============================================================================

describe('GitBackend Interface', () => {
  let backend: GitBackend

  beforeEach(() => {
    backend = createMemoryBackend()
  })

  describe('Interface Contract', () => {
    it('should export GitBackend interface type', () => {
      // This test verifies the interface exists and can be used for type checking
      const b: GitBackend = backend
      expect(b).toBeDefined()
    })

    it('should have all required methods', () => {
      expect(typeof backend.readObject).toBe('function')
      expect(typeof backend.writeObject).toBe('function')
      expect(typeof backend.hasObject).toBe('function')
      expect(typeof backend.readRef).toBe('function')
      expect(typeof backend.writeRef).toBe('function')
      expect(typeof backend.deleteRef).toBe('function')
      expect(typeof backend.listRefs).toBe('function')
      expect(typeof backend.readPackedRefs).toBe('function')
      expect(typeof backend.writePackfile).toBe('function')
    })
  })

  // ==========================================================================
  // Object Operations
  // ==========================================================================

  describe('readObject(sha: string): Promise<GitObject | null>', () => {
    it('should return null for non-existent object', async () => {
      const result = await backend.readObject('0000000000000000000000000000000000000000')
      expect(result).toBeNull()
    })

    it('should return null for invalid SHA format', async () => {
      const result = await backend.readObject('invalid-sha')
      expect(result).toBeNull()
    })

    it('should return GitObject with correct type and data for stored blob', async () => {
      const blob = createTestBlob('Hello, World!')
      const sha = await backend.writeObject(blob)

      const result = await backend.readObject(sha)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(result!.data).toEqual(blob.data)
    })

    it('should return GitObject for stored commit', async () => {
      const treeSha = '0'.repeat(40)
      const commit = createTestCommit(treeSha, 'Initial commit')
      const sha = await backend.writeObject(commit)

      const result = await backend.readObject(sha)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('commit')
    })

    it('should handle case-insensitive SHA lookup', async () => {
      const blob = createTestBlob('Test content')
      const sha = await backend.writeObject(blob)

      // Try uppercase version
      const upperSha = sha.toUpperCase()
      const result = await backend.readObject(upperSha)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
    })

    it('should return exact data that was stored', async () => {
      // Binary data that could be corrupted by text encoding
      const binaryData = new Uint8Array([0, 1, 127, 128, 255, 0, 10, 13])
      const blob: BlobObject = { type: 'blob', data: binaryData }
      const sha = await backend.writeObject(blob)

      const result = await backend.readObject(sha)

      expect(result!.data).toEqual(binaryData)
    })
  })

  describe('writeObject(obj: GitObject): Promise<string>', () => {
    it('should return 40-character lowercase hex SHA', async () => {
      const blob = createTestBlob('Test')

      const sha = await backend.writeObject(blob)

      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should compute correct SHA-1 for blob (Git format)', async () => {
      const content = textToBytes('Hello, World!')
      const blob: BlobObject = { type: 'blob', data: content }

      const sha = await backend.writeObject(blob)
      const expectedSha = await computeObjectSha('blob', content)

      expect(sha).toBe(expectedSha)
    })

    it('should compute correct SHA-1 for tree', async () => {
      // Tree entry: mode SP name NUL 20-byte-sha
      const treeData = new Uint8Array([
        // "100644 file.txt\0" + 20 bytes of sha
        49, 48, 48, 54, 52, 52, 32, 102, 105, 108, 101, 46, 116, 120, 116, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      ])
      const tree: TreeObject = {
        type: 'tree',
        data: treeData,
        entries: [{ mode: '100644', name: 'file.txt', sha: '0'.repeat(40) }]
      }

      const sha = await backend.writeObject(tree)
      const expectedSha = await computeObjectSha('tree', treeData)

      expect(sha).toBe(expectedSha)
    })

    it('should be idempotent (same content returns same SHA)', async () => {
      const blob = createTestBlob('Duplicate content')

      const sha1 = await backend.writeObject(blob)
      const sha2 = await backend.writeObject(blob)

      expect(sha1).toBe(sha2)
    })

    it('should store different content with different SHAs', async () => {
      const blob1 = createTestBlob('Content A')
      const blob2 = createTestBlob('Content B')

      const sha1 = await backend.writeObject(blob1)
      const sha2 = await backend.writeObject(blob2)

      expect(sha1).not.toBe(sha2)
    })

    it('should handle empty blob', async () => {
      const blob: BlobObject = { type: 'blob', data: new Uint8Array(0) }

      const sha = await backend.writeObject(blob)

      // Empty blob has a well-known SHA in Git
      // e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
      expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    })

    it('should handle large objects', async () => {
      // Create a 1MB blob
      const largeData = new Uint8Array(1024 * 1024)
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }
      const blob: BlobObject = { type: 'blob', data: largeData }

      const sha = await backend.writeObject(blob)

      expect(sha).toMatch(/^[0-9a-f]{40}$/)

      // Verify it can be read back
      const result = await backend.readObject(sha)
      expect(result!.data).toEqual(largeData)
    })

    it('should handle all object types (blob, tree, commit, tag)', async () => {
      const blob = createTestBlob('test')
      const blobSha = await backend.writeObject(blob)
      expect(blobSha).toMatch(/^[0-9a-f]{40}$/)

      const tree: TreeObject = {
        type: 'tree',
        data: new Uint8Array(0),
        entries: []
      }
      const treeSha = await backend.writeObject(tree)
      expect(treeSha).toMatch(/^[0-9a-f]{40}$/)

      const commit = createTestCommit(treeSha, 'test commit')
      const commitSha = await backend.writeObject(commit)
      expect(commitSha).toMatch(/^[0-9a-f]{40}$/)

      const tag: TagObject = {
        type: 'tag',
        data: textToBytes(`object ${commitSha}\ntype commit\ntag v1.0.0\ntagger Test <test@example.com.ai> 1704067200 +0000\n\nRelease`),
        object: commitSha,
        objectType: 'commit',
        name: 'v1.0.0',
        tagger: {
          name: 'Test',
          email: 'test@example.com.ai',
          timestamp: 1704067200,
          timezone: '+0000'
        },
        message: 'Release'
      }
      const tagSha = await backend.writeObject(tag)
      expect(tagSha).toMatch(/^[0-9a-f]{40}$/)
    })
  })

  describe('hasObject(sha: string): Promise<boolean>', () => {
    it('should return false for non-existent object', async () => {
      const result = await backend.hasObject('0000000000000000000000000000000000000000')
      expect(result).toBe(false)
    })

    it('should return false for invalid SHA', async () => {
      const result = await backend.hasObject('not-a-sha')
      expect(result).toBe(false)
    })

    it('should return true for existing object', async () => {
      const blob = createTestBlob('exists')
      const sha = await backend.writeObject(blob)

      const result = await backend.hasObject(sha)

      expect(result).toBe(true)
    })

    it('should be case-insensitive', async () => {
      const blob = createTestBlob('case test')
      const sha = await backend.writeObject(blob)

      expect(await backend.hasObject(sha.toLowerCase())).toBe(true)
      expect(await backend.hasObject(sha.toUpperCase())).toBe(true)
    })

    it('should be more efficient than readObject (no data returned)', async () => {
      // This test verifies the semantic difference - hasObject should be lighter weight
      const blob = createTestBlob('efficiency test')
      const sha = await backend.writeObject(blob)

      // Both should work, but hasObject returns boolean, not full object
      const has = await backend.hasObject(sha)
      const obj = await backend.readObject(sha)

      expect(has).toBe(true)
      expect(obj).not.toBeNull()
      expect(typeof has).toBe('boolean')
    })
  })

  // ==========================================================================
  // Reference Operations
  // ==========================================================================

  describe('readRef(name: string): Promise<string | null>', () => {
    it('should return null for non-existent ref', async () => {
      const result = await backend.readRef('refs/heads/nonexistent')
      expect(result).toBeNull()
    })

    it('should return SHA for existing ref', async () => {
      const sha = '0'.repeat(40)
      await backend.writeRef('refs/heads/main', sha)

      const result = await backend.readRef('refs/heads/main')

      expect(result).toBe(sha)
    })

    it('should handle HEAD ref', async () => {
      const sha = 'a'.repeat(40)
      await backend.writeRef('HEAD', sha)

      const result = await backend.readRef('HEAD')

      expect(result).toBe(sha)
    })

    it('should handle refs/tags prefix', async () => {
      const sha = 'b'.repeat(40)
      await backend.writeRef('refs/tags/v1.0.0', sha)

      const result = await backend.readRef('refs/tags/v1.0.0')

      expect(result).toBe(sha)
    })

    it('should handle refs/remotes prefix', async () => {
      const sha = 'c'.repeat(40)
      await backend.writeRef('refs/remotes/origin/main', sha)

      const result = await backend.readRef('refs/remotes/origin/main')

      expect(result).toBe(sha)
    })

    it('should return updated value after writeRef', async () => {
      const sha1 = 'a'.repeat(40)
      const sha2 = 'b'.repeat(40)
      await backend.writeRef('refs/heads/feature', sha1)

      expect(await backend.readRef('refs/heads/feature')).toBe(sha1)

      await backend.writeRef('refs/heads/feature', sha2)

      expect(await backend.readRef('refs/heads/feature')).toBe(sha2)
    })
  })

  describe('writeRef(name: string, sha: string): Promise<void>', () => {
    it('should create new ref', async () => {
      const sha = 'd'.repeat(40)

      await backend.writeRef('refs/heads/new-branch', sha)

      const result = await backend.readRef('refs/heads/new-branch')
      expect(result).toBe(sha)
    })

    it('should update existing ref', async () => {
      const sha1 = 'e'.repeat(40)
      const sha2 = 'f'.repeat(40)

      await backend.writeRef('refs/heads/branch', sha1)
      await backend.writeRef('refs/heads/branch', sha2)

      const result = await backend.readRef('refs/heads/branch')
      expect(result).toBe(sha2)
    })

    it('should handle nested ref paths', async () => {
      const sha = '1'.repeat(40)

      await backend.writeRef('refs/heads/feature/deeply/nested/branch', sha)

      const result = await backend.readRef('refs/heads/feature/deeply/nested/branch')
      expect(result).toBe(sha)
    })

    it('should store lowercase SHA', async () => {
      const upperSha = 'ABCDEF1234567890ABCDEF1234567890ABCDEF12'

      await backend.writeRef('refs/heads/test', upperSha)

      const result = await backend.readRef('refs/heads/test')
      // Should normalize to lowercase
      expect(result).toBe(upperSha.toLowerCase())
    })

    it('should handle multiple refs independently', async () => {
      const sha1 = '1'.repeat(40)
      const sha2 = '2'.repeat(40)
      const sha3 = '3'.repeat(40)

      await backend.writeRef('refs/heads/branch1', sha1)
      await backend.writeRef('refs/heads/branch2', sha2)
      await backend.writeRef('refs/tags/tag1', sha3)

      expect(await backend.readRef('refs/heads/branch1')).toBe(sha1)
      expect(await backend.readRef('refs/heads/branch2')).toBe(sha2)
      expect(await backend.readRef('refs/tags/tag1')).toBe(sha3)
    })
  })

  describe('deleteRef(name: string): Promise<void>', () => {
    it('should delete existing ref', async () => {
      const sha = '4'.repeat(40)
      await backend.writeRef('refs/heads/to-delete', sha)

      await backend.deleteRef('refs/heads/to-delete')

      const result = await backend.readRef('refs/heads/to-delete')
      expect(result).toBeNull()
    })

    it('should not throw for non-existent ref', async () => {
      // Should be idempotent - no error if ref doesn't exist
      await expect(backend.deleteRef('refs/heads/nonexistent')).resolves.toBeUndefined()
    })

    it('should only delete specified ref', async () => {
      const sha1 = '5'.repeat(40)
      const sha2 = '6'.repeat(40)
      await backend.writeRef('refs/heads/keep', sha1)
      await backend.writeRef('refs/heads/delete', sha2)

      await backend.deleteRef('refs/heads/delete')

      expect(await backend.readRef('refs/heads/keep')).toBe(sha1)
      expect(await backend.readRef('refs/heads/delete')).toBeNull()
    })

    it('should handle deleting HEAD', async () => {
      const sha = '7'.repeat(40)
      await backend.writeRef('HEAD', sha)

      await backend.deleteRef('HEAD')

      expect(await backend.readRef('HEAD')).toBeNull()
    })

    it('should handle nested ref deletion', async () => {
      const sha = '8'.repeat(40)
      await backend.writeRef('refs/heads/feature/test', sha)

      await backend.deleteRef('refs/heads/feature/test')

      expect(await backend.readRef('refs/heads/feature/test')).toBeNull()
    })
  })

  describe('listRefs(prefix?: string): Promise<Ref[]>', () => {
    beforeEach(async () => {
      // Set up some refs for testing
      await backend.writeRef('refs/heads/main', 'a'.repeat(40))
      await backend.writeRef('refs/heads/develop', 'b'.repeat(40))
      await backend.writeRef('refs/heads/feature/x', 'c'.repeat(40))
      await backend.writeRef('refs/tags/v1.0.0', 'd'.repeat(40))
      await backend.writeRef('refs/tags/v2.0.0', 'e'.repeat(40))
      await backend.writeRef('refs/remotes/origin/main', 'f'.repeat(40))
    })

    it('should list all refs when no prefix', async () => {
      const refs = await backend.listRefs()

      expect(refs.length).toBe(6)
      const names = refs.map(r => r.name)
      expect(names).toContain('refs/heads/main')
      expect(names).toContain('refs/heads/develop')
      expect(names).toContain('refs/heads/feature/x')
      expect(names).toContain('refs/tags/v1.0.0')
      expect(names).toContain('refs/tags/v2.0.0')
      expect(names).toContain('refs/remotes/origin/main')
    })

    it('should filter by refs/heads/ prefix', async () => {
      const refs = await backend.listRefs('refs/heads/')

      expect(refs.length).toBe(3)
      const names = refs.map(r => r.name)
      expect(names).toContain('refs/heads/main')
      expect(names).toContain('refs/heads/develop')
      expect(names).toContain('refs/heads/feature/x')
    })

    it('should filter by refs/tags/ prefix', async () => {
      const refs = await backend.listRefs('refs/tags/')

      expect(refs.length).toBe(2)
      const names = refs.map(r => r.name)
      expect(names).toContain('refs/tags/v1.0.0')
      expect(names).toContain('refs/tags/v2.0.0')
    })

    it('should filter by refs/remotes/ prefix', async () => {
      const refs = await backend.listRefs('refs/remotes/')

      expect(refs.length).toBe(1)
      expect(refs[0].name).toBe('refs/remotes/origin/main')
    })

    it('should return empty array for non-matching prefix', async () => {
      const refs = await backend.listRefs('refs/nonexistent/')

      expect(refs).toEqual([])
    })

    it('should include ref target SHA in results', async () => {
      const refs = await backend.listRefs('refs/heads/')

      const mainRef = refs.find(r => r.name === 'refs/heads/main')
      expect(mainRef).toBeDefined()
      expect(mainRef!.target).toBe('a'.repeat(40))
    })

    it('should return Ref objects with name and target', async () => {
      const refs = await backend.listRefs('refs/tags/')

      for (const ref of refs) {
        expect(ref).toHaveProperty('name')
        expect(ref).toHaveProperty('target')
        expect(typeof ref.name).toBe('string')
        expect(typeof ref.target).toBe('string')
        expect(ref.target).toMatch(/^[0-9a-f]{40}$/)
      }
    })

    it('should handle partial prefix matching', async () => {
      const refs = await backend.listRefs('refs/heads/feature')

      expect(refs.length).toBe(1)
      expect(refs[0].name).toBe('refs/heads/feature/x')
    })
  })

  // ==========================================================================
  // Packed Refs Operations
  // ==========================================================================

  describe('readPackedRefs(): Promise<PackedRefs>', () => {
    it('should return empty PackedRefs when no packed refs exist', async () => {
      const packed = await backend.readPackedRefs()

      expect(packed).toBeDefined()
      expect(packed.refs).toBeDefined()
      expect(packed.refs.size).toBe(0)
    })

    it('should return PackedRefs with refs Map', async () => {
      const packed = await backend.readPackedRefs()

      expect(packed.refs).toBeInstanceOf(Map)
    })

    it('should include peeled entries if available', async () => {
      // PackedRefs may have peeled entries for annotated tags
      const packed = await backend.readPackedRefs()

      expect(packed).toHaveProperty('refs')
      // peeled is optional
      if (packed.peeled) {
        expect(packed.peeled).toBeInstanceOf(Map)
      }
    })
  })

  describe('writePackfile(pack: Uint8Array): Promise<void>', () => {
    it('should accept a packfile without error', async () => {
      // Minimal valid packfile structure
      // PACK + version (4 bytes) + object count (4 bytes) + SHA checksum (20 bytes)
      const minimalPack = createMinimalPackfile()

      await expect(backend.writePackfile(minimalPack)).resolves.toBeUndefined()
    })

    it('should handle empty packfile (header only)', async () => {
      const emptyPack = createEmptyPackfile()

      await expect(backend.writePackfile(emptyPack)).resolves.toBeUndefined()
    })

    it('should make objects from packfile available via readObject', async () => {
      // Create a packfile containing a known blob
      const blob = createTestBlob('packfile test content')
      const expectedSha = await computeObjectSha('blob', blob.data)

      const pack = await createPackfileWithBlob(blob.data)
      await backend.writePackfile(pack)

      const result = await backend.readObject(expectedSha)
      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(result!.data).toEqual(blob.data)
    })

    it('should update hasObject for packfile objects', async () => {
      const blob = createTestBlob('hasObject packfile test')
      const expectedSha = await computeObjectSha('blob', blob.data)

      // Object should not exist before
      expect(await backend.hasObject(expectedSha)).toBe(false)

      const pack = await createPackfileWithBlob(blob.data)
      await backend.writePackfile(pack)

      // Object should exist after
      expect(await backend.hasObject(expectedSha)).toBe(true)
    })
  })

  // ==========================================================================
  // MemoryBackend Implementation
  // ==========================================================================

  describe('MemoryBackend', () => {
    it('should be creatable via createMemoryBackend()', () => {
      const memBackend = createMemoryBackend()
      expect(memBackend).toBeDefined()
    })

    it('should implement GitBackend interface', () => {
      const memBackend: GitBackend = createMemoryBackend()

      expect(typeof memBackend.readObject).toBe('function')
      expect(typeof memBackend.writeObject).toBe('function')
      expect(typeof memBackend.hasObject).toBe('function')
      expect(typeof memBackend.readRef).toBe('function')
      expect(typeof memBackend.writeRef).toBe('function')
      expect(typeof memBackend.deleteRef).toBe('function')
      expect(typeof memBackend.listRefs).toBe('function')
      expect(typeof memBackend.readPackedRefs).toBe('function')
      expect(typeof memBackend.writePackfile).toBe('function')
    })

    it('should store objects in memory only', async () => {
      const memBackend = createMemoryBackend()
      const blob = createTestBlob('memory only')

      const sha = await memBackend.writeObject(blob)
      const result = await memBackend.readObject(sha)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
    })

    it('should persist data across multiple operations', async () => {
      const memBackend = createMemoryBackend()

      // Write multiple objects
      const blob1 = createTestBlob('first')
      const blob2 = createTestBlob('second')
      const sha1 = await memBackend.writeObject(blob1)
      const sha2 = await memBackend.writeObject(blob2)

      // Write refs
      await memBackend.writeRef('refs/heads/main', sha1)
      await memBackend.writeRef('refs/heads/develop', sha2)

      // Verify all still accessible
      expect(await memBackend.hasObject(sha1)).toBe(true)
      expect(await memBackend.hasObject(sha2)).toBe(true)
      expect(await memBackend.readRef('refs/heads/main')).toBe(sha1)
      expect(await memBackend.readRef('refs/heads/develop')).toBe(sha2)
    })

    it('should clear all data when reset is called', async () => {
      const memBackend = createMemoryBackend() as MemoryBackend

      const blob = createTestBlob('to be cleared')
      const sha = await memBackend.writeObject(blob)
      await memBackend.writeRef('refs/heads/test', sha)

      // Verify data exists
      expect(await memBackend.hasObject(sha)).toBe(true)
      expect(await memBackend.readRef('refs/heads/test')).toBe(sha)

      // Clear all data
      memBackend.clear()

      // Verify data is gone
      expect(await memBackend.hasObject(sha)).toBe(false)
      expect(await memBackend.readRef('refs/heads/test')).toBeNull()
    })
  })

  // ==========================================================================
  // Backend Isolation
  // ==========================================================================

  describe('Backend Isolation', () => {
    it('multiple instances should not share object state', async () => {
      const backend1 = createMemoryBackend()
      const backend2 = createMemoryBackend()

      const blob = createTestBlob('isolated object')
      const sha = await backend1.writeObject(blob)

      // backend1 should have the object
      expect(await backend1.hasObject(sha)).toBe(true)

      // backend2 should NOT have the object
      expect(await backend2.hasObject(sha)).toBe(false)
    })

    it('multiple instances should not share ref state', async () => {
      const backend1 = createMemoryBackend()
      const backend2 = createMemoryBackend()

      const sha = 'a'.repeat(40)
      await backend1.writeRef('refs/heads/isolated', sha)

      // backend1 should have the ref
      expect(await backend1.readRef('refs/heads/isolated')).toBe(sha)

      // backend2 should NOT have the ref
      expect(await backend2.readRef('refs/heads/isolated')).toBeNull()
    })

    it('operations on one instance should not affect another', async () => {
      const backend1 = createMemoryBackend()
      const backend2 = createMemoryBackend()

      // Set up same ref in both
      const sha1 = '1'.repeat(40)
      const sha2 = '2'.repeat(40)
      await backend1.writeRef('refs/heads/main', sha1)
      await backend2.writeRef('refs/heads/main', sha2)

      // Update in backend1
      const sha3 = '3'.repeat(40)
      await backend1.writeRef('refs/heads/main', sha3)

      // backend1 should have new value
      expect(await backend1.readRef('refs/heads/main')).toBe(sha3)

      // backend2 should still have its original value
      expect(await backend2.readRef('refs/heads/main')).toBe(sha2)
    })

    it('deleting in one instance should not affect another', async () => {
      const backend1 = createMemoryBackend()
      const backend2 = createMemoryBackend()

      const sha = 'a'.repeat(40)
      await backend1.writeRef('refs/heads/shared-name', sha)
      await backend2.writeRef('refs/heads/shared-name', sha)

      await backend1.deleteRef('refs/heads/shared-name')

      // backend1 should not have it
      expect(await backend1.readRef('refs/heads/shared-name')).toBeNull()

      // backend2 should still have it
      expect(await backend2.readRef('refs/heads/shared-name')).toBe(sha)
    })

    it('listRefs should only return refs from own instance', async () => {
      const backend1 = createMemoryBackend()
      const backend2 = createMemoryBackend()

      await backend1.writeRef('refs/heads/b1-only', '1'.repeat(40))
      await backend2.writeRef('refs/heads/b2-only', '2'.repeat(40))

      const refs1 = await backend1.listRefs()
      const refs2 = await backend2.listRefs()

      expect(refs1.map(r => r.name)).toContain('refs/heads/b1-only')
      expect(refs1.map(r => r.name)).not.toContain('refs/heads/b2-only')

      expect(refs2.map(r => r.name)).toContain('refs/heads/b2-only')
      expect(refs2.map(r => r.name)).not.toContain('refs/heads/b1-only')
    })
  })

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle ref names with special characters', async () => {
      const sha = 'a'.repeat(40)

      // Valid ref names per Git spec
      await backend.writeRef('refs/heads/feature-123', sha)
      await backend.writeRef('refs/heads/feature_456', sha)
      await backend.writeRef('refs/heads/feature.789', sha)

      expect(await backend.readRef('refs/heads/feature-123')).toBe(sha)
      expect(await backend.readRef('refs/heads/feature_456')).toBe(sha)
      expect(await backend.readRef('refs/heads/feature.789')).toBe(sha)
    })

    it('should handle binary object data correctly', async () => {
      // Create object with all possible byte values
      const data = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        data[i] = i
      }
      const blob: BlobObject = { type: 'blob', data }

      const sha = await backend.writeObject(blob)
      const result = await backend.readObject(sha)

      expect(result!.data).toEqual(data)
    })

    it('should handle concurrent operations', async () => {
      const blobs = Array.from({ length: 10 }, (_, i) =>
        createTestBlob(`concurrent ${i}`)
      )

      // Write all concurrently
      const shas = await Promise.all(
        blobs.map(blob => backend.writeObject(blob))
      )

      // Verify all exist
      const exists = await Promise.all(
        shas.map(sha => backend.hasObject(sha))
      )

      expect(exists.every(e => e)).toBe(true)
    })

    it('should handle rapid ref updates', async () => {
      const updates = Array.from({ length: 100 }, (_, i) =>
        i.toString(16).padStart(40, '0')
      )

      // Update same ref many times
      for (const sha of updates) {
        await backend.writeRef('refs/heads/rapid', sha)
      }

      // Should have the last value
      const result = await backend.readRef('refs/heads/rapid')
      expect(result).toBe(updates[updates.length - 1])
    })
  })
})

// ============================================================================
// Helper Functions for Packfile Tests
// ============================================================================

/**
 * Create a minimal valid packfile structure.
 */
function createMinimalPackfile(): Uint8Array {
  // Packfile format:
  // - 4 bytes: "PACK"
  // - 4 bytes: version (2)
  // - 4 bytes: object count (0)
  // - 20 bytes: SHA-1 checksum of the above

  const header = new Uint8Array([
    0x50, 0x41, 0x43, 0x4b,  // "PACK"
    0x00, 0x00, 0x00, 0x02,  // version 2
    0x00, 0x00, 0x00, 0x00,  // 0 objects
  ])

  // For a minimal test, we'll create a placeholder checksum
  // Real implementation would compute SHA-1 of header
  const checksum = new Uint8Array(20)

  const pack = new Uint8Array(header.length + checksum.length)
  pack.set(header)
  pack.set(checksum, header.length)

  return pack
}

/**
 * Create an empty packfile with proper header.
 */
function createEmptyPackfile(): Uint8Array {
  return createMinimalPackfile()
}

/**
 * Create a packfile containing a single blob.
 * Note: This is a placeholder - real implementation would need proper packfile encoding.
 */
async function createPackfileWithBlob(blobData: Uint8Array): Promise<Uint8Array> {
  // This is a simplified representation
  // Real packfile format is more complex with:
  // - Variable-length encoded object sizes
  // - Zlib compressed data
  // - Delta encoding support

  const header = new Uint8Array([
    0x50, 0x41, 0x43, 0x4b,  // "PACK"
    0x00, 0x00, 0x00, 0x02,  // version 2
    0x00, 0x00, 0x00, 0x01,  // 1 object
  ])

  // Object type 3 (blob) in high bits, size in low bits
  // This is simplified - real encoding is more complex
  const objectHeader = new Uint8Array([
    0x30 | (blobData.length & 0x0f),  // type 3 (blob) + size low bits
    ...encodeVariableLength(blobData.length >> 4)
  ])

  // In real packfile, data would be zlib compressed
  const compressedData = blobData

  // Checksum placeholder
  const checksum = new Uint8Array(20)

  const totalLength = header.length + objectHeader.length + compressedData.length + checksum.length
  const pack = new Uint8Array(totalLength)

  let offset = 0
  pack.set(header, offset); offset += header.length
  pack.set(objectHeader, offset); offset += objectHeader.length
  pack.set(compressedData, offset); offset += compressedData.length
  pack.set(checksum, offset)

  return pack
}

/**
 * Encode a number in Git's variable-length format.
 */
function encodeVariableLength(n: number): number[] {
  const bytes: number[] = []
  while (n > 0) {
    bytes.push(0x80 | (n & 0x7f))
    n >>= 7
  }
  if (bytes.length > 0) {
    bytes[bytes.length - 1] &= 0x7f  // Clear MSB on last byte
  }
  return bytes
}
