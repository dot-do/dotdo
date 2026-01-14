import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ContentAddressableFS, CASStorage, CASObject, ObjectType } from './content-addressable-fs'
import type { BatchProgress } from './put-object'
import { sha1 } from './hash'
import { createGitObject } from './git-object'
import { compress, decompress } from './compression'
import { hashToPath } from './path-mapping'

/**
 * Mock storage implementation for testing
 */
class MockCASStorage implements CASStorage {
  public objects: Map<string, Uint8Array> = new Map()

  async write(path: string, data: Uint8Array): Promise<void> {
    this.objects.set(path, data)
  }

  async get(path: string): Promise<{ data: Uint8Array } | null> {
    const data = this.objects.get(path)
    if (!data) return null
    return { data }
  }

  async exists(path: string): Promise<boolean> {
    return this.objects.has(path)
  }

  async delete(path: string): Promise<void> {
    this.objects.delete(path)
  }

  clear(): void {
    this.objects.clear()
  }
}

/**
 * Helper to store a git object directly in mock storage (bypassing CAS)
 * Used for testing getObject
 */
async function storeObjectDirectly(
  storage: MockCASStorage,
  type: string,
  content: Uint8Array
): Promise<string> {
  const gitObject = createGitObject(type, content)
  const compressed = await compress(gitObject)
  const hash = await sha1(gitObject)
  const path = hashToPath(hash)
  await storage.write(path, compressed)
  return hash
}

describe('ContentAddressableFS', () => {
  let storage: MockCASStorage
  let cas: ContentAddressableFS
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  beforeEach(() => {
    storage = new MockCASStorage()
    cas = new ContentAddressableFS(storage)
  })

  describe('constructor', () => {
    it('should create an instance with storage', () => {
      expect(cas).toBeInstanceOf(ContentAddressableFS)
    })
  })

  describe('putObject', () => {
    describe('Basic Storage', () => {
      it('should store a blob and return 40-char SHA-1 hash', async () => {
        const content = encoder.encode('hello')
        const hash = await cas.putObject(content, 'blob')

        expect(hash).toHaveLength(40)
        expect(hash).toMatch(/^[a-f0-9]{40}$/)
      })

      it('should store content at correct path', async () => {
        const content = encoder.encode('test content')
        const hash = await cas.putObject(content, 'blob')

        const expectedPath = hashToPath(hash)
        expect(storage.objects.has(expectedPath)).toBe(true)
      })

      it('should store compressed git object format', async () => {
        const content = encoder.encode('hello')
        const hash = await cas.putObject(content, 'blob')

        const path = hashToPath(hash)
        const storedData = storage.objects.get(path)!

        // Should start with zlib header (0x78)
        expect(storedData[0]).toBe(0x78)

        // Decompress and verify git object format
        const decompressed = await decompress(storedData)
        const nullIndex = decompressed.indexOf(0x00)
        const header = decoder.decode(decompressed.slice(0, nullIndex))
        expect(header).toBe('blob 5')
      })

      it('should store tree object', async () => {
        const treeContent = new Uint8Array([
          ...encoder.encode('100644 file.txt\0'),
          // 20-byte SHA placeholder
          ...new Array(20).fill(0xaa),
        ])
        const hash = await cas.putObject(treeContent, 'tree')

        expect(hash).toHaveLength(40)
        expect(storage.objects.size).toBe(1)
      })

      it('should store commit object', async () => {
        const commitContent = encoder.encode(
          'tree 0000000000000000000000000000000000000000\n' +
            'author Test <test@test.com> 1234567890 +0000\n' +
            'committer Test <test@test.com> 1234567890 +0000\n\n' +
            'Initial commit'
        )
        const hash = await cas.putObject(commitContent, 'commit')

        expect(hash).toHaveLength(40)
        expect(storage.objects.size).toBe(1)
      })

      it('should store tag object', async () => {
        const tagContent = encoder.encode(
          'object 0000000000000000000000000000000000000000\n' +
            'type commit\n' +
            'tag v1.0.0\n' +
            'tagger Test <test@test.com> 1234567890 +0000\n\n' +
            'Release v1.0.0'
        )
        const hash = await cas.putObject(tagContent, 'tag')

        expect(hash).toHaveLength(40)
        expect(storage.objects.size).toBe(1)
      })
    })

    describe('Hash Verification', () => {
      it('should match known git hash for "hello" blob', async () => {
        // echo -n "hello" | git hash-object --stdin
        const content = encoder.encode('hello')
        const hash = await cas.putObject(content, 'blob')

        expect(hash).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0')
      })

      it('should match known git hash for empty blob', async () => {
        // git hash-object -t blob /dev/null
        const content = new Uint8Array([])
        const hash = await cas.putObject(content, 'blob')

        expect(hash).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
      })

      it('should produce same hash for same content (deterministic)', async () => {
        const content = encoder.encode('test content')

        const hash1 = await cas.putObject(content, 'blob')
        storage.clear()
        const hash2 = await cas.putObject(content, 'blob')

        expect(hash1).toBe(hash2)
      })

      it('should produce different hash for different content', async () => {
        const hash1 = await cas.putObject(encoder.encode('content one'), 'blob')
        const hash2 = await cas.putObject(encoder.encode('content two'), 'blob')

        expect(hash1).not.toBe(hash2)
      })
    })

    describe('Error Handling', () => {
      it('should throw error for invalid type', async () => {
        const content = encoder.encode('test')

        await expect(cas.putObject(content, 'invalid' as ObjectType)).rejects.toThrow()
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty content', async () => {
        const content = new Uint8Array([])
        const hash = await cas.putObject(content, 'blob')

        expect(hash).toHaveLength(40)
      })

      it('should handle binary content with null bytes', async () => {
        const content = new Uint8Array([0x00, 0x00, 0x00, 0xff, 0xfe])
        const hash = await cas.putObject(content, 'blob')

        expect(hash).toHaveLength(40)
      })

      it('should handle large content (1MB)', async () => {
        const size = 1024 * 1024
        const content = new Uint8Array(size)
        for (let i = 0; i < size; i++) {
          content[i] = i % 256
        }

        const hash = await cas.putObject(content, 'blob')
        expect(hash).toHaveLength(40)
      })
    })
  })

  describe('getObject', () => {
    describe('Basic Retrieval', () => {
      it('should retrieve a stored blob object', async () => {
        const content = encoder.encode('hello world')
        const hash = await storeObjectDirectly(storage, 'blob', content)

        const result = await cas.getObject(hash)

        expect(result).not.toBeNull()
        expect(result!.type).toBe('blob')
        expect(result!.data).toEqual(content)
      })

      it('should retrieve a stored tree object', async () => {
        const treeContent = new Uint8Array([
          ...encoder.encode('100644 file.txt\0'),
          ...new Array(20).fill(0xbb),
        ])
        const hash = await storeObjectDirectly(storage, 'tree', treeContent)

        const result = await cas.getObject(hash)

        expect(result).not.toBeNull()
        expect(result!.type).toBe('tree')
        expect(result!.data).toEqual(treeContent)
      })

      it('should retrieve a stored commit object', async () => {
        const commitContent = encoder.encode(
          'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n' +
            'author Test <test@test.com> 1234567890 +0000\n' +
            'committer Test <test@test.com> 1234567890 +0000\n\n' +
            'Test commit'
        )
        const hash = await storeObjectDirectly(storage, 'commit', commitContent)

        const result = await cas.getObject(hash)

        expect(result).not.toBeNull()
        expect(result!.type).toBe('commit')
        expect(result!.data).toEqual(commitContent)
      })

      it('should return null for non-existent object', async () => {
        const nonExistentHash = 'a'.repeat(40)

        const result = await cas.getObject(nonExistentHash)

        expect(result).toBeNull()
      })
    })

    describe('Hash Format Handling', () => {
      it('should accept lowercase SHA-1 hash', async () => {
        const content = encoder.encode('lowercase test')
        const hash = await storeObjectDirectly(storage, 'blob', content)

        const result = await cas.getObject(hash.toLowerCase())

        expect(result).not.toBeNull()
        expect(result!.data).toEqual(content)
      })

      it('should accept uppercase SHA-1 hash', async () => {
        const content = encoder.encode('uppercase test')
        const hash = await storeObjectDirectly(storage, 'blob', content)

        const result = await cas.getObject(hash.toUpperCase())

        expect(result).not.toBeNull()
        expect(result!.data).toEqual(content)
      })

      it('should throw error for invalid hash - wrong length', async () => {
        await expect(cas.getObject('abc123')).rejects.toThrow(/invalid hash/i)
      })

      it('should throw error for invalid hash - non-hex characters', async () => {
        const invalidHash = 'z'.repeat(40)
        await expect(cas.getObject(invalidHash)).rejects.toThrow(/invalid hash/i)
      })

      it('should throw error for empty hash', async () => {
        await expect(cas.getObject('')).rejects.toThrow(/invalid hash/i)
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty content object', async () => {
        const content = new Uint8Array([])
        const hash = await storeObjectDirectly(storage, 'blob', content)

        const result = await cas.getObject(hash)

        expect(result).not.toBeNull()
        expect(result!.type).toBe('blob')
        expect(result!.data.length).toBe(0)
      })

      it('should handle binary content with null bytes', async () => {
        const content = new Uint8Array([0x00, 0x01, 0x00, 0x02, 0xff])
        const hash = await storeObjectDirectly(storage, 'blob', content)

        const result = await cas.getObject(hash)

        expect(result).not.toBeNull()
        expect(result!.data).toEqual(content)
      })
    })
  })

  describe('hasObject', () => {
    describe('Basic Checks', () => {
      it('should return true for existing object', async () => {
        const content = encoder.encode('test')
        const hash = await cas.putObject(content, 'blob')

        const exists = await cas.hasObject(hash)

        expect(exists).toBe(true)
      })

      it('should return false for non-existing object', async () => {
        const nonExistentHash = 'a'.repeat(40)

        const exists = await cas.hasObject(nonExistentHash)

        expect(exists).toBe(false)
      })

      it('should return false for empty storage', async () => {
        const hash = 'b'.repeat(40)

        const exists = await cas.hasObject(hash)

        expect(exists).toBe(false)
      })
    })

    describe('Hash Format Handling', () => {
      it('should accept lowercase SHA-1 hash', async () => {
        const content = encoder.encode('lowercase check')
        const hash = await cas.putObject(content, 'blob')

        const exists = await cas.hasObject(hash.toLowerCase())

        expect(exists).toBe(true)
      })

      it('should accept uppercase SHA-1 hash', async () => {
        const content = encoder.encode('uppercase check')
        const hash = await cas.putObject(content, 'blob')

        const exists = await cas.hasObject(hash.toUpperCase())

        expect(exists).toBe(true)
      })

      it('should accept 64-char SHA-256 hash format', async () => {
        const hash = 'a'.repeat(64)

        // Should not throw for valid format (even if object doesn't exist)
        const exists = await cas.hasObject(hash)
        expect(exists).toBe(false)
      })

      it('should throw error for invalid hash length', async () => {
        await expect(cas.hasObject('abc123')).rejects.toThrow(/invalid hash/i)
      })

      it('should throw error for non-hex characters', async () => {
        const invalidHash = 'g'.repeat(40)
        await expect(cas.hasObject(invalidHash)).rejects.toThrow(/invalid hash/i)
      })
    })
  })

  describe('deleteObject', () => {
    describe('Basic Deletion', () => {
      it('should delete an existing object', async () => {
        const content = encoder.encode('to be deleted')
        const hash = await cas.putObject(content, 'blob')

        expect(await cas.hasObject(hash)).toBe(true)

        await cas.deleteObject(hash)

        expect(await cas.hasObject(hash)).toBe(false)
      })

      it('should not throw when deleting non-existent object', async () => {
        const nonExistentHash = 'a'.repeat(40)

        // Should not throw
        await expect(cas.deleteObject(nonExistentHash)).resolves.toBeUndefined()
      })

      it('should delete from correct path', async () => {
        const content = encoder.encode('delete path test')
        const hash = await cas.putObject(content, 'blob')
        const path = hashToPath(hash)

        expect(storage.objects.has(path)).toBe(true)

        await cas.deleteObject(hash)

        expect(storage.objects.has(path)).toBe(false)
      })
    })

    describe('Hash Format Handling', () => {
      it('should accept lowercase hash', async () => {
        const content = encoder.encode('lowercase delete')
        const hash = await cas.putObject(content, 'blob')

        await cas.deleteObject(hash.toLowerCase())

        expect(await cas.hasObject(hash)).toBe(false)
      })

      it('should accept uppercase hash', async () => {
        const content = encoder.encode('uppercase delete')
        const hash = await cas.putObject(content, 'blob')

        await cas.deleteObject(hash.toUpperCase())

        expect(await cas.hasObject(hash)).toBe(false)
      })

      it('should throw error for invalid hash', async () => {
        await expect(cas.deleteObject('invalid')).rejects.toThrow(/invalid hash/i)
      })
    })
  })

  describe('Round-trip', () => {
    it('should round-trip blob content correctly', async () => {
      const originalContent = encoder.encode('round-trip blob test')

      const hash = await cas.putObject(originalContent, 'blob')
      const result = await cas.getObject(hash)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(result!.data).toEqual(originalContent)
    })

    it('should round-trip tree content correctly', async () => {
      const treeContent = new Uint8Array([
        ...encoder.encode('100644 test.txt\0'),
        ...new Array(20).fill(0xcc),
      ])

      const hash = await cas.putObject(treeContent, 'tree')
      const result = await cas.getObject(hash)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('tree')
      expect(result!.data).toEqual(treeContent)
    })

    it('should round-trip commit content correctly', async () => {
      const commitContent = encoder.encode(
        'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n' +
          'parent 0000000000000000000000000000000000000000\n' +
          'author Test <t@t.com> 1000000000 +0000\n' +
          'committer Test <t@t.com> 1000000000 +0000\n\n' +
          'Test commit message\n\nWith multiple lines.'
      )

      const hash = await cas.putObject(commitContent, 'commit')
      const result = await cas.getObject(hash)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('commit')
      expect(result!.data).toEqual(commitContent)
    })

    it('should round-trip tag content correctly', async () => {
      const tagContent = encoder.encode(
        'object 0000000000000000000000000000000000000000\n' +
          'type commit\n' +
          'tag v2.0.0\n' +
          'tagger Developer <dev@example.com.ai> 1600000000 -0700\n\n' +
          'Version 2.0.0 release'
      )

      const hash = await cas.putObject(tagContent, 'tag')
      const result = await cas.getObject(hash)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('tag')
      expect(result!.data).toEqual(tagContent)
    })

    it('should round-trip empty blob correctly', async () => {
      const emptyContent = new Uint8Array([])

      const hash = await cas.putObject(emptyContent, 'blob')
      const result = await cas.getObject(hash)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(result!.data.length).toBe(0)
    })

    it('should round-trip binary content with all byte values', async () => {
      const content = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        content[i] = i
      }

      const hash = await cas.putObject(content, 'blob')
      const result = await cas.getObject(hash)

      expect(result).not.toBeNull()
      expect(result!.data).toEqual(content)
    })
  })

  describe('Deduplication', () => {
    it('should not create duplicate storage for same content', async () => {
      const content = encoder.encode('duplicate content')

      await cas.putObject(content, 'blob')
      await cas.putObject(content, 'blob')

      // Should only have one object stored
      expect(storage.objects.size).toBe(1)
    })

    it('should return same hash for same content', async () => {
      const content = encoder.encode('same content hash')

      const hash1 = await cas.putObject(content, 'blob')
      const hash2 = await cas.putObject(content, 'blob')

      expect(hash1).toBe(hash2)
    })

    it('should skip write when object already exists', async () => {
      const writeSpy = vi.spyOn(storage, 'write')
      const content = encoder.encode('dedup write check')

      // First write should happen
      await cas.putObject(content, 'blob')
      expect(writeSpy).toHaveBeenCalledTimes(1)

      // Second write should be skipped (deduplication)
      await cas.putObject(content, 'blob')
      expect(writeSpy).toHaveBeenCalledTimes(1) // Still 1, not 2
    })

    it('should call exists before write for deduplication check', async () => {
      const existsSpy = vi.spyOn(storage, 'exists')
      const content = encoder.encode('exists check content')

      await cas.putObject(content, 'blob')

      // Should have checked existence before write
      expect(existsSpy).toHaveBeenCalled()
    })

    it('should produce different hash for same content but different object type', async () => {
      // Same raw content, but stored as different object types
      // Git header includes type, so hash will differ
      const content = encoder.encode('type-specific content')

      const blobHash = await cas.putObject(content, 'blob')
      storage.clear() // Clear to avoid deduplication from different hash
      const treeHash = await cas.putObject(content, 'tree')

      // Hash should differ because git object format includes type in header
      expect(blobHash).not.toBe(treeHash)
    })

    it('should deduplicate same content and type across multiple calls', async () => {
      const content = encoder.encode('deduplicated across calls')

      // Multiple puts of same blob
      const hash1 = await cas.putObject(content, 'blob')
      const hash2 = await cas.putObject(content, 'blob')
      const hash3 = await cas.putObject(content, 'blob')

      // All should return same hash
      expect(hash1).toBe(hash2)
      expect(hash2).toBe(hash3)

      // Only one object stored
      expect(storage.objects.size).toBe(1)
    })

    it('should track storage correctly with mixed unique and duplicate content', async () => {
      const content1 = encoder.encode('unique content 1')
      const content2 = encoder.encode('unique content 2')
      const sharedContent = encoder.encode('shared content')

      await cas.putObject(content1, 'blob')
      await cas.putObject(sharedContent, 'blob')
      await cas.putObject(content2, 'blob')
      await cas.putObject(sharedContent, 'blob') // duplicate
      await cas.putObject(sharedContent, 'blob') // duplicate

      // Should have exactly 3 unique objects
      expect(storage.objects.size).toBe(3)
    })

    it('should not count different types of same content as duplicates', async () => {
      const content = encoder.encode('multi-type content')

      await cas.putObject(content, 'blob')
      await cas.putObject(content, 'tree')
      await cas.putObject(content, 'commit')
      await cas.putObject(content, 'tag')

      // Each type creates a unique object (different git header)
      expect(storage.objects.size).toBe(4)
    })

    it('should handle rapid sequential puts of same content', async () => {
      const content = encoder.encode('rapid fire content')

      // Simulate rapid sequential writes
      const hashes = await Promise.all([
        cas.putObject(content, 'blob'),
        cas.putObject(content, 'blob'),
        cas.putObject(content, 'blob'),
        cas.putObject(content, 'blob'),
        cas.putObject(content, 'blob'),
      ])

      // All hashes should be identical
      expect(new Set(hashes).size).toBe(1)

      // Only one object should be stored
      expect(storage.objects.size).toBe(1)
    })
  })

  describe('Integration with storage interface', () => {
    it('should call storage.write on putObject', async () => {
      const writeSpy = vi.spyOn(storage, 'write')
      const content = encoder.encode('storage write test')

      await cas.putObject(content, 'blob')

      expect(writeSpy).toHaveBeenCalledTimes(1)
      expect(writeSpy).toHaveBeenCalledWith(expect.stringMatching(/^objects\/[a-f0-9]{2}\/[a-f0-9]{38}$/), expect.any(Uint8Array))
    })

    it('should call storage.get on getObject', async () => {
      const content = encoder.encode('storage get test')
      const hash = await cas.putObject(content, 'blob')
      const getSpy = vi.spyOn(storage, 'get')

      await cas.getObject(hash)

      expect(getSpy).toHaveBeenCalledTimes(1)
      expect(getSpy).toHaveBeenCalledWith(hashToPath(hash))
    })

    it('should call storage.exists on hasObject', async () => {
      const existsSpy = vi.spyOn(storage, 'exists')
      const hash = 'a'.repeat(40)

      await cas.hasObject(hash)

      expect(existsSpy).toHaveBeenCalledTimes(1)
      expect(existsSpy).toHaveBeenCalledWith(hashToPath(hash))
    })

    it('should call storage.delete on deleteObject', async () => {
      const deleteSpy = vi.spyOn(storage, 'delete')
      const hash = 'b'.repeat(40)

      await cas.deleteObject(hash)

      expect(deleteSpy).toHaveBeenCalledTimes(1)
      expect(deleteSpy).toHaveBeenCalledWith(hashToPath(hash))
    })
  })

  describe('Reference Counting', () => {
    describe('getRefCount', () => {
      it('should return 0 for non-existent object', async () => {
        const hash = 'a'.repeat(40)

        const refCount = await cas.getRefCount(hash)

        expect(refCount).toBe(0)
      })

      it('should return 1 after first putObject', async () => {
        const content = encoder.encode('refcount test')
        const hash = await cas.putObject(content, 'blob')

        const refCount = await cas.getRefCount(hash)

        expect(refCount).toBe(1)
      })

      it('should increment refcount on duplicate put', async () => {
        const content = encoder.encode('duplicate refcount')

        await cas.putObject(content, 'blob')
        const hash = await cas.putObject(content, 'blob')

        const refCount = await cas.getRefCount(hash)

        expect(refCount).toBe(2)
      })

      it('should track refcount correctly for multiple puts', async () => {
        const content = encoder.encode('multi put refcount')

        const hash = await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob')

        const refCount = await cas.getRefCount(hash)

        expect(refCount).toBe(4)
      })

      it('should throw error for invalid hash', async () => {
        await expect(cas.getRefCount('invalid')).rejects.toThrow(/invalid hash/i)
      })
    })

    describe('deleteObject with refcounting', () => {
      it('should decrement refcount on delete', async () => {
        const content = encoder.encode('delete refcount')

        const hash = await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob') // refcount = 2

        await cas.deleteObject(hash)

        const refCount = await cas.getRefCount(hash)
        expect(refCount).toBe(1)
      })

      it('should not delete object if refcount > 0 after decrement', async () => {
        const content = encoder.encode('keep object alive')

        const hash = await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob') // refcount = 2

        await cas.deleteObject(hash) // decrement to 1

        // Object should still exist
        expect(await cas.hasObject(hash)).toBe(true)
        const obj = await cas.getObject(hash)
        expect(obj).not.toBeNull()
        expect(decoder.decode(obj!.data)).toBe('keep object alive')
      })

      it('should delete object only when refcount reaches 0', async () => {
        const content = encoder.encode('final delete')

        const hash = await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob') // refcount = 2

        await cas.deleteObject(hash) // refcount = 1
        expect(await cas.hasObject(hash)).toBe(true)

        await cas.deleteObject(hash) // refcount = 0 -> delete
        expect(await cas.hasObject(hash)).toBe(false)
      })

      it('should not decrement below 0', async () => {
        const content = encoder.encode('no negative refcount')
        const hash = await cas.putObject(content, 'blob')

        await cas.deleteObject(hash) // refcount = 0 -> delete
        await cas.deleteObject(hash) // already deleted

        const refCount = await cas.getRefCount(hash)
        expect(refCount).toBe(0)
      })

      it('should handle delete on non-existent object gracefully', async () => {
        const hash = 'c'.repeat(40)

        // Should not throw
        await expect(cas.deleteObject(hash)).resolves.toBeUndefined()

        const refCount = await cas.getRefCount(hash)
        expect(refCount).toBe(0)
      })
    })

    describe('forceDelete', () => {
      it('should delete object regardless of refcount', async () => {
        const content = encoder.encode('force delete test')

        const hash = await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob') // refcount = 3

        await cas.forceDelete(hash)

        expect(await cas.hasObject(hash)).toBe(false)
        expect(await cas.getRefCount(hash)).toBe(0)
      })

      it('should throw error for invalid hash', async () => {
        await expect(cas.forceDelete('invalid')).rejects.toThrow(/invalid hash/i)
      })
    })

    describe('getStats', () => {
      it('should return empty stats for empty storage', async () => {
        const stats = await cas.getStats()

        expect(stats.totalObjects).toBe(0)
        expect(stats.totalReferences).toBe(0)
        expect(stats.deduplicatedBytes).toBe(0)
      })

      it('should count total objects', async () => {
        await cas.putObject(encoder.encode('object 1'), 'blob')
        await cas.putObject(encoder.encode('object 2'), 'blob')
        await cas.putObject(encoder.encode('object 3'), 'blob')

        const stats = await cas.getStats()

        expect(stats.totalObjects).toBe(3)
      })

      it('should count total references including duplicates', async () => {
        const content = encoder.encode('shared content')

        await cas.putObject(content, 'blob') // 1 object, 1 ref
        await cas.putObject(content, 'blob') // still 1 object, 2 refs
        await cas.putObject(content, 'blob') // still 1 object, 3 refs

        const stats = await cas.getStats()

        expect(stats.totalObjects).toBe(1)
        expect(stats.totalReferences).toBe(3)
      })

      it('should calculate deduplicated bytes saved', async () => {
        const content = encoder.encode('shared content for dedup')
        const contentSize = content.length

        await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob')
        await cas.putObject(content, 'blob')

        const stats = await cas.getStats()

        // 3 refs - 1 object = 2 duplicates saved
        expect(stats.deduplicatedBytes).toBe(contentSize * 2)
      })

      it('should track average refcount', async () => {
        const content1 = encoder.encode('content 1')
        const content2 = encoder.encode('content 2')

        await cas.putObject(content1, 'blob') // 1 ref
        await cas.putObject(content1, 'blob') // 2 refs
        await cas.putObject(content2, 'blob') // 1 ref

        const stats = await cas.getStats()

        // Total: 2 objects, 3 refs, avg = 1.5
        expect(stats.totalObjects).toBe(2)
        expect(stats.totalReferences).toBe(3)
        expect(stats.averageRefCount).toBeCloseTo(1.5)
      })
    })
  })

  describe('putObjectBatch', () => {
    describe('Basic Batch Storage', () => {
      it('should store multiple objects and return results', async () => {
        const items = [
          { data: encoder.encode('hello'), type: 'blob' as const },
          { data: encoder.encode('world'), type: 'blob' as const },
          { data: encoder.encode('test'), type: 'blob' as const },
        ]

        const results = await cas.putObjectBatch(items)

        expect(results).toHaveLength(3)
        expect(storage.objects.size).toBe(3)
      })

      it('should return 40-char hex hashes for all items', async () => {
        const items = [
          { data: encoder.encode('batch1'), type: 'blob' as const },
          { data: encoder.encode('batch2'), type: 'blob' as const },
        ]

        const results = await cas.putObjectBatch(items)

        results.forEach(result => {
          expect(result.hash).toHaveLength(40)
          expect(result.hash).toMatch(/^[a-f0-9]{40}$/)
        })
      })

      it('should maintain correct index in results', async () => {
        const items = [
          { data: encoder.encode('first'), type: 'blob' as const },
          { data: encoder.encode('second'), type: 'blob' as const },
        ]

        const results = await cas.putObjectBatch(items)

        expect(results[0].index).toBe(0)
        expect(results[1].index).toBe(1)
      })

      it('should return empty array for empty input', async () => {
        const results = await cas.putObjectBatch([])

        expect(results).toEqual([])
        expect(storage.objects.size).toBe(0)
      })
    })

    describe('Mixed Object Types', () => {
      it('should store different object types in batch', async () => {
        const items = [
          { data: encoder.encode('blob content'), type: 'blob' as const },
          { data: new Uint8Array([1, 2, 3]), type: 'tree' as const },
          { data: encoder.encode('commit content'), type: 'commit' as const },
          { data: encoder.encode('tag content'), type: 'tag' as const },
        ]

        const results = await cas.putObjectBatch(items)

        expect(results).toHaveLength(4)
        expect(storage.objects.size).toBe(4)
      })
    })

    describe('Progress Callback', () => {
      it('should call progress callback for each item', async () => {
        const items = [
          { data: encoder.encode('item1'), type: 'blob' as const },
          { data: encoder.encode('item2'), type: 'blob' as const },
          { data: encoder.encode('item3'), type: 'blob' as const },
        ]

        const progressCalls: BatchProgress[] = []
        await cas.putObjectBatch(items, {
          onProgress: (progress) => progressCalls.push({ ...progress }),
        })

        expect(progressCalls).toHaveLength(3)
        expect(progressCalls[0].total).toBe(3)
      })

      it('should include hash in progress callback', async () => {
        const items = [
          { data: encoder.encode('progress test'), type: 'blob' as const },
        ]

        let capturedHash = ''
        await cas.putObjectBatch(items, {
          onProgress: (progress) => { capturedHash = progress.currentHash },
        })

        expect(capturedHash).toHaveLength(40)
      })
    })

    describe('Reference Counting with Batch', () => {
      it('should increment refcount for each item in batch', async () => {
        const items = [
          { data: encoder.encode('ref item 1'), type: 'blob' as const },
          { data: encoder.encode('ref item 2'), type: 'blob' as const },
        ]

        const results = await cas.putObjectBatch(items)

        for (const result of results) {
          const refCount = await cas.getRefCount(result.hash)
          expect(refCount).toBe(1)
        }
      })

      it('should track stats correctly after batch put', async () => {
        const items = [
          { data: encoder.encode('stats item 1'), type: 'blob' as const },
          { data: encoder.encode('stats item 2'), type: 'blob' as const },
          { data: encoder.encode('stats item 3'), type: 'blob' as const },
        ]

        await cas.putObjectBatch(items)

        const stats = await cas.getStats()
        expect(stats.totalObjects).toBe(3)
        expect(stats.totalReferences).toBe(3)
      })

      it('should increment refcount for duplicates in batch (sequential)', async () => {
        const content = encoder.encode('duplicate in batch')
        const items = [
          { data: content, type: 'blob' as const },
          { data: content, type: 'blob' as const },
        ]

        // Sequential processing to ensure proper refcount tracking
        const results = await cas.putObjectBatch(items, { concurrency: 1 })

        // Both should have same hash
        expect(results[0].hash).toBe(results[1].hash)

        // Should have 2 references
        const refCount = await cas.getRefCount(results[0].hash)
        expect(refCount).toBe(2)
      })
    })

    describe('Deduplication', () => {
      it('should not create duplicate storage for same content', async () => {
        const content = encoder.encode('dedup batch content')
        const items = [
          { data: content, type: 'blob' as const },
          { data: content, type: 'blob' as const },
        ]

        await cas.putObjectBatch(items, { concurrency: 1 })

        // Should only have one object stored
        expect(storage.objects.size).toBe(1)
      })

      it('should mark written=false for pre-existing objects', async () => {
        const content = encoder.encode('existing batch')

        // First, store via single put
        await cas.putObject(content, 'blob')

        // Now batch put the same content
        const items = [{ data: content, type: 'blob' as const }]
        const results = await cas.putObjectBatch(items)

        expect(results[0].written).toBe(false)
      })
    })

    describe('Round-trip', () => {
      it('should round-trip batch content correctly', async () => {
        const items = [
          { data: encoder.encode('batch round-trip 1'), type: 'blob' as const },
          { data: encoder.encode('batch round-trip 2'), type: 'blob' as const },
        ]

        const results = await cas.putObjectBatch(items)

        for (let i = 0; i < results.length; i++) {
          const retrieved = await cas.getObject(results[i].hash)
          expect(retrieved).not.toBeNull()
          expect(retrieved!.type).toBe('blob')
          expect(retrieved!.data).toEqual(items[i].data)
        }
      })
    })
  })

  describe('LRU Caching', () => {
    describe('Cache Disabled (default)', () => {
      it('should not enable cache by default', () => {
        expect(cas.isCacheEnabled()).toBe(false)
      })

      it('should return null for getCacheStats when cache disabled', () => {
        expect(cas.getCacheStats()).toBeNull()
      })

      it('should work normally without cache', async () => {
        const content = encoder.encode('no cache test')
        const hash = await cas.putObject(content, 'blob')

        const result = await cas.getObject(hash)
        expect(result).not.toBeNull()
        expect(result!.data).toEqual(content)
      })
    })

    describe('Cache Enabled', () => {
      let cachedCas: ContentAddressableFS

      beforeEach(() => {
        storage = new MockCASStorage()
        cachedCas = new ContentAddressableFS(storage, { cache: true })
      })

      it('should enable cache when cache: true', () => {
        expect(cachedCas.isCacheEnabled()).toBe(true)
      })

      it('should return cache stats when enabled', () => {
        const stats = cachedCas.getCacheStats()
        expect(stats).not.toBeNull()
        expect(stats!.hits).toBe(0)
        expect(stats!.misses).toBe(0)
      })

      it('should cache getObject results', async () => {
        const content = encoder.encode('cached object')
        const hash = await cachedCas.putObject(content, 'blob')

        // First get - cache miss
        await cachedCas.getObject(hash)
        let stats = cachedCas.getCacheStats()!
        expect(stats.misses).toBe(1)
        expect(stats.hits).toBe(0)

        // Second get - cache hit
        await cachedCas.getObject(hash)
        stats = cachedCas.getCacheStats()!
        expect(stats.misses).toBe(1)
        expect(stats.hits).toBe(1)
      })

      it('should return correct data from cache', async () => {
        const content = encoder.encode('verify cached data')
        const hash = await cachedCas.putObject(content, 'blob')

        // First get - from storage
        const result1 = await cachedCas.getObject(hash)
        // Second get - from cache
        const result2 = await cachedCas.getObject(hash)

        expect(result1!.data).toEqual(content)
        expect(result2!.data).toEqual(content)
        expect(result1!.type).toBe(result2!.type)
      })

      it('should avoid storage.get on cache hit', async () => {
        const getSpy = vi.spyOn(storage, 'get')
        const content = encoder.encode('storage spy test')
        const hash = await cachedCas.putObject(content, 'blob')

        getSpy.mockClear()

        // First get - calls storage
        await cachedCas.getObject(hash)
        expect(getSpy).toHaveBeenCalledTimes(1)

        // Second get - should NOT call storage (cache hit)
        await cachedCas.getObject(hash)
        expect(getSpy).toHaveBeenCalledTimes(1) // Still 1
      })

      it('should calculate hit ratio correctly', async () => {
        const content = encoder.encode('hit ratio test')
        const hash = await cachedCas.putObject(content, 'blob')

        await cachedCas.getObject(hash) // miss
        await cachedCas.getObject(hash) // hit
        await cachedCas.getObject(hash) // hit
        await cachedCas.getObject(hash) // hit

        const stats = cachedCas.getCacheStats()!
        expect(stats.hitRatio).toBe(0.75) // 3 hits / 4 total
      })

      it('should clear cache without affecting storage', async () => {
        const content = encoder.encode('clear cache test')
        const hash = await cachedCas.putObject(content, 'blob')

        await cachedCas.getObject(hash) // miss - adds to cache

        cachedCas.clearCache()

        // Object still exists in storage
        expect(await cachedCas.hasObject(hash)).toBe(true)

        // But next get is a cache miss
        await cachedCas.getObject(hash)
        const stats = cachedCas.getCacheStats()!
        expect(stats.misses).toBe(2)
      })

      it('should reset cache stats', async () => {
        const content = encoder.encode('reset stats test')
        const hash = await cachedCas.putObject(content, 'blob')

        await cachedCas.getObject(hash)
        await cachedCas.getObject(hash)

        let stats = cachedCas.getCacheStats()!
        expect(stats.hits).toBe(1)
        expect(stats.misses).toBe(1)

        cachedCas.resetCacheStats()

        stats = cachedCas.getCacheStats()!
        expect(stats.hits).toBe(0)
        expect(stats.misses).toBe(0)
      })

      it('should invalidate cache entry on deleteObject', async () => {
        const content = encoder.encode('delete cache test')
        const hash = await cachedCas.putObject(content, 'blob')

        // Put it in cache
        await cachedCas.getObject(hash)

        // Delete the object
        await cachedCas.deleteObject(hash)

        // Object is gone
        const result = await cachedCas.getObject(hash)
        expect(result).toBeNull()
      })

      it('should invalidate cache entry on forceDelete', async () => {
        const content = encoder.encode('force delete cache test')
        const hash = await cachedCas.putObject(content, 'blob')
        await cachedCas.putObject(content, 'blob') // refcount = 2

        // Put it in cache
        await cachedCas.getObject(hash)

        // Force delete
        await cachedCas.forceDelete(hash)

        // Object is gone
        const result = await cachedCas.getObject(hash)
        expect(result).toBeNull()
      })
    })

    describe('Cache with Custom Options', () => {
      it('should accept custom maxEntries', () => {
        const customCas = new ContentAddressableFS(storage, {
          cache: { maxEntries: 100 },
        })

        const stats = customCas.getCacheStats()!
        expect(stats.maxEntries).toBe(100)
      })

      it('should accept custom maxBytes', () => {
        const customCas = new ContentAddressableFS(storage, {
          cache: { maxBytes: 1024 * 1024 },
        })

        const stats = customCas.getCacheStats()!
        expect(stats.maxBytes).toBe(1024 * 1024)
      })

      it('should respect cache limits', async () => {
        const smallCacheCas = new ContentAddressableFS(storage, {
          cache: { maxEntries: 2, maxBytes: 10000 },
        })

        // Store 3 objects
        const hash1 = await smallCacheCas.putObject(encoder.encode('first'), 'blob')
        const hash2 = await smallCacheCas.putObject(encoder.encode('second'), 'blob')
        const hash3 = await smallCacheCas.putObject(encoder.encode('third'), 'blob')

        // Get all 3 to cache them
        await smallCacheCas.getObject(hash1)
        await smallCacheCas.getObject(hash2)
        await smallCacheCas.getObject(hash3)

        // Cache should only have 2 entries (maxEntries = 2)
        const stats = smallCacheCas.getCacheStats()!
        expect(stats.entryCount).toBe(2)

        // First object should be evicted
        expect(stats.evictions).toBe(1)
      })
    })
  })
})
