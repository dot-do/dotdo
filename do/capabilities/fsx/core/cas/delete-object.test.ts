import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { deleteObject, setStorage, type DeleteObjectStorage } from './delete-object'
import { hashToPath } from './path-mapping'

/**
 * Tests for deleteObject - removing git objects from CAS by hash
 *
 * deleteObject removes objects from the content-addressable storage:
 * 1. Validates the hash format (SHA-1 40 chars, SHA-256 64 chars)
 * 2. Converts hash to path using hashToPath()
 * 3. Deletes the file at that path
 * 4. Returns gracefully for non-existent objects (no-op)
 *
 * Requirements:
 * - Delete object by hash
 * - Verify object no longer exists after delete
 * - Delete non-existent object (no-op, no error)
 * - Batch delete multiple objects
 * - Clean up empty directories after delete
 */

// Sample valid hashes for testing
const VALID_SHA1_HASH = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
const VALID_SHA256_HASH = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

/**
 * Create a mock storage that tracks existing objects and deletions
 */
function createMockStorage(existingHashes: Set<string> = new Set()): DeleteObjectStorage & {
  deletedPaths: string[]
  existingHashes: Set<string>
} {
  const deletedPaths: string[] = []
  const existingHashesSet = new Set(existingHashes)

  return {
    existingHashes: existingHashesSet,
    deletedPaths,
    delete: vi.fn(async (path: string): Promise<void> => {
      deletedPaths.push(path)
      // Find and remove the hash that corresponds to this path
      for (const hash of existingHashesSet) {
        if (hashToPath(hash) === path) {
          existingHashesSet.delete(hash)
          break
        }
      }
    }),
    exists: vi.fn(async (path: string): Promise<boolean> => {
      for (const hash of existingHashesSet) {
        if (hashToPath(hash) === path) {
          return true
        }
      }
      return false
    }),
  }
}

describe('deleteObject', () => {
  let mockStorage: ReturnType<typeof createMockStorage>

  beforeEach(() => {
    // Set up mock storage with VALID_SHA1_HASH existing
    mockStorage = createMockStorage(new Set([VALID_SHA1_HASH]))
    setStorage(mockStorage)
  })

  afterEach(() => {
    // Clean up storage after each test
    setStorage(null)
  })

  describe('Basic Deletion', () => {
    it('should delete an existing object by hash', async () => {
      const hash = VALID_SHA1_HASH

      await deleteObject(hash)

      // Verify delete was called with correct path
      expect(mockStorage.delete).toHaveBeenCalledWith(hashToPath(hash))
      expect(mockStorage.deletedPaths).toContain(hashToPath(hash))
    })

    it('should return void on successful deletion', async () => {
      const hash = VALID_SHA1_HASH

      const result = await deleteObject(hash)

      expect(result).toBeUndefined()
    })

    it('should not throw when deleting non-existent object', async () => {
      const nonExistentHash = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

      // Should not throw
      await expect(deleteObject(nonExistentHash)).resolves.toBeUndefined()
    })

    it('should delete from correct path based on hash', async () => {
      const hash = VALID_SHA1_HASH
      const expectedPath = hashToPath(hash)

      await deleteObject(hash)

      expect(mockStorage.delete).toHaveBeenCalledWith(expectedPath)
    })
  })

  describe('Verification After Delete', () => {
    it('should remove object from storage after deletion', async () => {
      const hash = VALID_SHA1_HASH

      // Object exists before delete
      expect(await mockStorage.exists(hashToPath(hash))).toBe(true)

      await deleteObject(hash)

      // Object should no longer exist after delete
      expect(await mockStorage.exists(hashToPath(hash))).toBe(false)
    })

    it('should allow delete of already deleted object (idempotent)', async () => {
      const hash = VALID_SHA1_HASH

      await deleteObject(hash)
      // Deleting again should not throw
      await expect(deleteObject(hash)).resolves.toBeUndefined()
    })

    it('should delete storage entry such that hasObject returns false', async () => {
      // This test documents expected integration behavior
      // After deleteObject(hash), hasObject(hash) should return false
      const hash = VALID_SHA1_HASH

      // Before delete
      expect(mockStorage.existingHashes.has(hash)).toBe(true)

      await deleteObject(hash)

      // After delete, the hash should be removed
      expect(mockStorage.existingHashes.has(hash)).toBe(false)
    })

    it('should delete storage entry such that getObject returns null', async () => {
      // This test documents expected integration behavior
      // After deleteObject(hash), getObject(hash) should return null
      const hash = VALID_SHA1_HASH

      await deleteObject(hash)

      // The storage path should be gone
      const path = hashToPath(hash)
      expect(await mockStorage.exists(path)).toBe(false)
    })
  })

  describe('Hash Format Handling', () => {
    it('should accept lowercase SHA-1 hash', async () => {
      const hash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      await expect(deleteObject(hash)).resolves.toBeUndefined()
    })

    it('should accept uppercase SHA-1 hash and normalize', async () => {
      const upperHash = 'AAF4C61DDCC5E8A2DABEDE0F3B482CD9AEA9434D'

      await deleteObject(upperHash)

      // Should call delete with lowercase path
      const expectedPath = hashToPath(upperHash.toLowerCase())
      expect(mockStorage.delete).toHaveBeenCalledWith(expectedPath)
    })

    it('should accept mixed-case SHA-1 hash and normalize', async () => {
      const mixedHash = 'AaF4c61dDCC5e8a2dabede0f3B482cd9aea9434D'

      await deleteObject(mixedHash)

      // Should normalize to lowercase
      const expectedPath = hashToPath(mixedHash.toLowerCase())
      expect(mockStorage.delete).toHaveBeenCalledWith(expectedPath)
    })

    it('should accept 64-char SHA-256 hash', async () => {
      const hash = VALID_SHA256_HASH
      await expect(deleteObject(hash)).resolves.toBeUndefined()
    })

    it('should accept uppercase SHA-256 hash and normalize', async () => {
      const upperHash = VALID_SHA256_HASH.toUpperCase()

      await deleteObject(upperHash)

      const expectedPath = hashToPath(VALID_SHA256_HASH)
      expect(mockStorage.delete).toHaveBeenCalledWith(expectedPath)
    })
  })

  describe('Error Handling - Invalid Hash', () => {
    it('should throw error for hash that is too short', async () => {
      const shortHash = 'aaf4c61'
      await expect(deleteObject(shortHash)).rejects.toThrow(/invalid hash/i)
    })

    it('should throw error for hash that is too long', async () => {
      const longHash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434daa'
      await expect(deleteObject(longHash)).rejects.toThrow(/invalid hash/i)
    })

    it('should throw error for hash with invalid length (not 40 or 64)', async () => {
      // 50 characters - neither SHA-1 nor SHA-256
      const invalidLengthHash = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d1234567890'
      await expect(deleteObject(invalidLengthHash)).rejects.toThrow(/invalid hash/i)
    })

    it('should throw error for hash with non-hex characters', async () => {
      const nonHexHash = 'ghijklmnopqrstuvwxyzabcdef1234567890123456'
      await expect(deleteObject(nonHexHash)).rejects.toThrow(/invalid hash/i)
    })

    it('should throw error for empty hash', async () => {
      await expect(deleteObject('')).rejects.toThrow(/invalid hash/i)
    })

    it('should throw error for hash with spaces', async () => {
      const hashWithSpaces = 'aaf4c61ddcc5e8a2 dabede0f3b482cd9aea9434d'
      await expect(deleteObject(hashWithSpaces)).rejects.toThrow(/invalid hash/i)
    })

    it('should throw error for hash with special characters', async () => {
      const hashWithSpecialChars = 'aaf4c61ddcc5e8a2-dabede0f3b482cd9aea9434d'
      await expect(deleteObject(hashWithSpecialChars)).rejects.toThrow(/invalid hash/i)
    })

    it('should throw error for hash with newline', async () => {
      const hashWithNewline = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434\n'
      await expect(deleteObject(hashWithNewline)).rejects.toThrow(/invalid hash/i)
    })

    it('should NOT call storage.delete when hash is invalid', async () => {
      const invalidHash = 'invalid'

      try {
        await deleteObject(invalidHash)
      } catch {
        // Expected to throw
      }

      expect(mockStorage.delete).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases - Special Hash Values', () => {
    it('should handle hash with leading zeros (00...)', async () => {
      const hashWithLeadingZeros = '00a4c61ddcc5e8a2dabede0f3b482cd9aea9434d'
      await expect(deleteObject(hashWithLeadingZeros)).resolves.toBeUndefined()
    })

    it('should handle hash with all same characters (aaa...)', async () => {
      const allSameHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      await expect(deleteObject(allSameHash)).resolves.toBeUndefined()
    })

    it('should handle all-zeros SHA-1 hash', async () => {
      const allZerosHash = '0000000000000000000000000000000000000000'
      await expect(deleteObject(allZerosHash)).resolves.toBeUndefined()
    })

    it('should handle all-fs SHA-1 hash', async () => {
      const allFsHash = 'ffffffffffffffffffffffffffffffffffffffff'
      await expect(deleteObject(allFsHash)).resolves.toBeUndefined()
    })

    it('should handle all-zeros SHA-256 hash', async () => {
      const allZerosHash256 = '0000000000000000000000000000000000000000000000000000000000000000'
      await expect(deleteObject(allZerosHash256)).resolves.toBeUndefined()
    })

    it('should handle all-fs SHA-256 hash', async () => {
      const allFsHash256 = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      await expect(deleteObject(allFsHash256)).resolves.toBeUndefined()
    })
  })

  describe('Case Sensitivity', () => {
    it('should delete same object regardless of hash case', async () => {
      const lowerHash = VALID_SHA1_HASH.toLowerCase()
      const upperHash = VALID_SHA1_HASH.toUpperCase()

      // Set up storage with lowercase hash
      mockStorage = createMockStorage(new Set([lowerHash]))
      setStorage(mockStorage)

      // Delete with uppercase hash should still work
      await deleteObject(upperHash)

      // Object should be deleted
      expect(mockStorage.existingHashes.has(lowerHash)).toBe(false)
    })
  })

  describe('Integration with hashToPath', () => {
    it('should use hashToPath internally for path resolution', async () => {
      const hash = VALID_SHA1_HASH
      const expectedPath = hashToPath(hash)

      await deleteObject(hash)

      expect(mockStorage.delete).toHaveBeenCalledWith(expectedPath)
    })

    it('should fail with same errors as hashToPath for invalid hashes', async () => {
      const invalidHash = 'not-valid'
      await expect(deleteObject(invalidHash)).rejects.toThrow()
    })
  })

  describe('Return Type Validation', () => {
    it('should return a Promise that resolves to void', async () => {
      const hash = VALID_SHA1_HASH
      const promise = deleteObject(hash)

      expect(promise).toBeInstanceOf(Promise)
      const result = await promise
      expect(result).toBeUndefined()
    })

    it('should return void, not null or false', async () => {
      const hash = VALID_SHA1_HASH
      const result = await deleteObject(hash)

      expect(result).not.toBe(null)
      expect(result).not.toBe(false)
      expect(result).toBeUndefined()
    })
  })

  describe('Storage Interface Integration', () => {
    it('should call storage.delete on deleteObject', async () => {
      const hash = VALID_SHA1_HASH

      await deleteObject(hash)

      expect(mockStorage.delete).toHaveBeenCalledTimes(1)
    })

    it('should pass correct path to storage.delete', async () => {
      const hash = VALID_SHA1_HASH
      const expectedPath = `objects/${hash.slice(0, 2)}/${hash.slice(2)}`

      await deleteObject(hash)

      expect(mockStorage.delete).toHaveBeenCalledWith(expectedPath)
    })
  })

  describe('Batch Delete Multiple Objects', () => {
    it('should support deleting multiple objects sequentially', async () => {
      const hash1 = VALID_SHA1_HASH
      const hash2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      const hash3 = 'cccccccccccccccccccccccccccccccccccccccc'

      mockStorage = createMockStorage(new Set([hash1, hash2, hash3]))
      setStorage(mockStorage)

      await deleteObject(hash1)
      await deleteObject(hash2)
      await deleteObject(hash3)

      expect(mockStorage.delete).toHaveBeenCalledTimes(3)
      expect(mockStorage.deletedPaths).toHaveLength(3)
    })

    it('should not fail batch when some objects do not exist', async () => {
      const existingHash = VALID_SHA1_HASH
      const nonExistentHash = 'dddddddddddddddddddddddddddddddddddddddd'

      mockStorage = createMockStorage(new Set([existingHash]))
      setStorage(mockStorage)

      // Mix of existing and non-existing should not throw
      await deleteObject(existingHash)
      await deleteObject(nonExistentHash)

      expect(mockStorage.delete).toHaveBeenCalledTimes(2)
    })
  })

  describe('Directory Cleanup', () => {
    /**
     * These tests document expected behavior for directory cleanup
     * after object deletion. When the last object in a directory
     * is deleted, the empty directory should also be removed.
     */

    it('should delete object at correct nested path structure', async () => {
      const hash = VALID_SHA1_HASH

      await deleteObject(hash)

      // Path should be objects/aa/f4c61ddcc5e8a2dabede0f3b482cd9aea9434d
      const expectedPath = `objects/${hash.slice(0, 2)}/${hash.slice(2)}`
      expect(mockStorage.delete).toHaveBeenCalledWith(expectedPath)
    })

    // Note: Actual directory cleanup implementation may be storage-specific
    // and tested at integration level. This documents the expected contract.
  })

  describe('No Storage Configured', () => {
    it('should handle gracefully when no storage is set', async () => {
      setStorage(null)

      const hash = VALID_SHA1_HASH
      // When no storage is configured, delete should be a no-op
      await expect(deleteObject(hash)).resolves.toBeUndefined()
    })
  })
})
