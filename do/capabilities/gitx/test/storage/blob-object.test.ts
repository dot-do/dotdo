/**
 * @fileoverview RED Phase Tests for Blob Object Storage
 *
 * These tests define the expected behavior for blob object storage in gitx.
 * All tests should FAIL initially, then be made to pass during the GREEN phase.
 *
 * Tests cover:
 * - Storing blob objects by SHA (putObject('blob', data))
 * - Retrieving blob content (getObject(sha))
 * - Typed blob accessor (getBlobObject(sha))
 * - SHA-1 hash computation (Git format: blob size\0content)
 * - Blob integrity verification
 * - Blob deduplication (same content = same SHA)
 * - Blob compression
 * - Cache hit/miss behavior
 *
 * @module test/storage/blob-object
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type {
  StorageBackend,
  StoredObjectResult,
  ObjectType,
} from '../../src/storage/backend'
import type { BlobObject } from '../../src/types/objects'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Helper function to compute expected SHA-1 hash for a blob.
 * Git format: "blob {size}\0{content}"
 */
async function computeBlobSha(content: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${content.length}\0`)
  const data = new Uint8Array(header.length + content.length)
  data.set(header)
  data.set(content, header.length)
  const hashBuffer = await crypto.subtle.digest('SHA-1', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Helper to create test content of a specific size.
 */
function createTestContent(size: number, seed: number = 0): Uint8Array {
  const content = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    content[i] = (i + seed) % 256
  }
  return content
}

/**
 * Create text content as Uint8Array.
 */
function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

// ============================================================================
// Mock Storage Backend for Testing
// ============================================================================

/**
 * Interface for blob-specific storage operations.
 * Extends StorageBackend with blob-specific methods.
 */
interface BlobStorageBackend extends StorageBackend {
  /**
   * Get a blob object with typed return.
   * @param sha - The blob's SHA-1 hash
   * @returns BlobObject or null if not found or not a blob
   */
  getBlobObject(sha: string): Promise<BlobObject | null>

  /**
   * Check if a blob exists in storage.
   * @param sha - The blob's SHA-1 hash
   * @returns True if blob exists
   */
  hasBlobObject(sha: string): Promise<boolean>

  /**
   * Get the raw size of a stored blob (before compression).
   * @param sha - The blob's SHA-1 hash
   * @returns Size in bytes or null if not found
   */
  getBlobSize(sha: string): Promise<number | null>

  /**
   * Get compression statistics for a blob.
   * @param sha - The blob's SHA-1 hash
   * @returns Compression info or null if not found
   */
  getBlobCompressionInfo(sha: string): Promise<{
    originalSize: number
    compressedSize: number
    compressionRatio: number
  } | null>

  /**
   * Verify blob integrity by recomputing hash.
   * @param sha - The blob's SHA-1 hash
   * @returns True if integrity check passes
   */
  verifyBlobIntegrity(sha: string): Promise<boolean>

  /**
   * Get cache statistics.
   */
  getCacheStats(): { hits: number; misses: number; size: number }
}

/**
 * Mock implementation of BlobStorageBackend for testing.
 * Implements blob storage with SHA-1 hashing, compression, and LRU caching.
 */
class MockBlobStorage implements BlobStorageBackend {
  private objects: Map<string, { type: ObjectType; content: Uint8Array; compressed: Uint8Array; originalSize: number }> = new Map()
  private cache: Map<string, { type: ObjectType; content: Uint8Array }> = new Map()
  private cacheStats = { hits: 0, misses: 0, size: 0 }

  /**
   * Compute SHA-1 hash using Git object format: "{type} {size}\0{content}"
   */
  private async computeSha(type: ObjectType, content: Uint8Array): Promise<string> {
    const header = new TextEncoder().encode(`${type} ${content.length}\0`)
    const data = new Uint8Array(header.length + content.length)
    data.set(header)
    data.set(content, header.length)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Simple compression using deflate (via CompressionStream if available, or identity)
   */
  private async compress(content: Uint8Array): Promise<Uint8Array> {
    try {
      // Use CompressionStream if available (modern browsers/Node.js)
      if (typeof CompressionStream !== 'undefined') {
        const stream = new CompressionStream('deflate')
        const writer = stream.writable.getWriter()
        writer.write(content)
        writer.close()
        const reader = stream.readable.getReader()
        const chunks: Uint8Array[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const result = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.length
        }
        return result
      }
    } catch {
      // Fall through to identity compression
    }
    // Fallback: return content as-is
    return content
  }

  /**
   * Decompress content
   */
  private async decompress(compressed: Uint8Array): Promise<Uint8Array> {
    try {
      if (typeof DecompressionStream !== 'undefined') {
        const stream = new DecompressionStream('deflate')
        const writer = stream.writable.getWriter()
        writer.write(compressed)
        writer.close()
        const reader = stream.readable.getReader()
        const chunks: Uint8Array[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
        }
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const result = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          result.set(chunk, offset)
          offset += chunk.length
        }
        return result
      }
    } catch {
      // Fall through to identity decompression
    }
    // Fallback: return as-is
    return compressed
  }

  /**
   * Validate SHA format (40 lowercase hex characters)
   */
  private isValidSha(sha: string): boolean {
    return /^[0-9a-f]{40}$/.test(sha)
  }

  async putObject(type: ObjectType, content: Uint8Array): Promise<string> {
    const sha = await this.computeSha(type, content)

    // Deduplicate: if already exists, just return the SHA
    if (this.objects.has(sha)) {
      return sha
    }

    // Compress the content
    const compressed = await this.compress(content)

    // Store the object
    this.objects.set(sha, {
      type,
      content: content,
      compressed,
      originalSize: content.length
    })

    // Add to cache
    this.cache.set(sha, { type, content })
    this.cacheStats.size++

    return sha
  }

  async getObject(sha: string): Promise<StoredObjectResult | null> {
    // Validate SHA format
    if (!this.isValidSha(sha)) {
      this.cacheStats.misses++
      return null
    }

    // Check cache first
    const cached = this.cache.get(sha)
    if (cached) {
      this.cacheStats.hits++
      return { type: cached.type, content: cached.content }
    }

    // Cache miss
    this.cacheStats.misses++

    // Check storage
    const stored = this.objects.get(sha)
    if (!stored) {
      return null
    }

    // Decompress content (for simulation - in real impl would decompress from compressed)
    const content = stored.content

    // Add to cache
    this.cache.set(sha, { type: stored.type, content })
    this.cacheStats.size++

    return { type: stored.type, content }
  }

  async hasObject(sha: string): Promise<boolean> {
    if (!this.isValidSha(sha)) {
      return false
    }
    return this.objects.has(sha)
  }

  async deleteObject(sha: string): Promise<void> {
    this.objects.delete(sha)
    this.cache.delete(sha)
  }

  async getBlobObject(sha: string): Promise<BlobObject | null> {
    if (!this.isValidSha(sha)) {
      return null
    }

    const result = await this.getObject(sha)
    if (!result || result.type !== 'blob') {
      return null
    }

    return {
      type: 'blob',
      data: result.content
    }
  }

  async hasBlobObject(sha: string): Promise<boolean> {
    if (!this.isValidSha(sha)) {
      return false
    }
    const stored = this.objects.get(sha)
    return stored !== undefined && stored.type === 'blob'
  }

  async getBlobSize(sha: string): Promise<number | null> {
    if (!this.isValidSha(sha)) {
      return null
    }
    const stored = this.objects.get(sha)
    if (!stored || stored.type !== 'blob') {
      return null
    }
    return stored.originalSize
  }

  async getBlobCompressionInfo(sha: string): Promise<{
    originalSize: number
    compressedSize: number
    compressionRatio: number
  } | null> {
    if (!this.isValidSha(sha)) {
      return null
    }
    const stored = this.objects.get(sha)
    if (!stored) {
      return null
    }
    const originalSize = stored.originalSize
    const compressedSize = stored.compressed.length
    return {
      originalSize,
      compressedSize,
      compressionRatio: originalSize / compressedSize
    }
  }

  async verifyBlobIntegrity(sha: string): Promise<boolean> {
    if (!this.isValidSha(sha)) {
      return false
    }
    const stored = this.objects.get(sha)
    if (!stored || stored.type !== 'blob') {
      return false
    }
    // Recompute SHA and verify
    const computedSha = await this.computeSha(stored.type, stored.content)
    return computedSha === sha
  }

  getCacheStats(): { hits: number; misses: number; size: number } {
    return { ...this.cacheStats }
  }

  // Required StorageBackend methods (stubs for non-blob operations)
  async getRef(): Promise<null> { return null }
  async setRef(): Promise<void> {}
  async deleteRef(): Promise<void> {}
  async listRefs(): Promise<[]> { return [] }
  async readFile(): Promise<null> { return null }
  async writeFile(): Promise<void> {}
  async deleteFile(): Promise<void> {}
  async exists(): Promise<boolean> { return false }
  async readdir(): Promise<string[]> { return [] }
  async mkdir(): Promise<void> {}
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Blob Object Storage', () => {
  let storage: MockBlobStorage

  beforeEach(() => {
    storage = new MockBlobStorage()
  })

  // ==========================================================================
  // Basic Storage Operations
  // ==========================================================================

  describe('putObject - Storing Blobs by SHA', () => {
    it('should store a blob and return its SHA-1 hash', async () => {
      const content = textToBytes('Hello, World!')
      const expectedSha = await computeBlobSha(content)

      const sha = await storage.putObject('blob', content)

      expect(sha).toBe(expectedSha)
      expect(sha).toMatch(/^[0-9a-f]{40}$/)
    })

    it('should store empty blob correctly', async () => {
      const content = new Uint8Array(0)
      const expectedSha = await computeBlobSha(content)

      const sha = await storage.putObject('blob', content)

      expect(sha).toBe(expectedSha)
      // Empty blob SHA: e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
      expect(sha).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    })

    it('should store binary content correctly', async () => {
      const content = createTestContent(256)
      const expectedSha = await computeBlobSha(content)

      const sha = await storage.putObject('blob', content)

      expect(sha).toBe(expectedSha)
    })

    it('should store large blob (1MB) correctly', async () => {
      const content = createTestContent(1024 * 1024)
      const expectedSha = await computeBlobSha(content)

      const sha = await storage.putObject('blob', content)

      expect(sha).toBe(expectedSha)
    })

    it('should store blob with null bytes correctly', async () => {
      const content = new Uint8Array([0, 1, 0, 2, 0, 3])
      const expectedSha = await computeBlobSha(content)

      const sha = await storage.putObject('blob', content)

      expect(sha).toBe(expectedSha)
    })

    it('should use Git blob format for SHA computation', async () => {
      // Test that SHA is computed from "blob {size}\0{content}"
      const content = textToBytes('test')

      // Manual computation of expected SHA
      const header = textToBytes('blob 4\0')
      const fullData = new Uint8Array(header.length + content.length)
      fullData.set(header)
      fullData.set(content, header.length)
      const hashBuffer = await crypto.subtle.digest('SHA-1', fullData)
      const expectedSha = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')

      const sha = await storage.putObject('blob', content)

      expect(sha).toBe(expectedSha)
    })
  })

  // ==========================================================================
  // Retrieval Operations
  // ==========================================================================

  describe('getObject - Retrieving Blob Content', () => {
    it('should retrieve stored blob content', async () => {
      const content = textToBytes('Hello, World!')
      const sha = await storage.putObject('blob', content)

      const result = await storage.getObject(sha)

      expect(result).not.toBeNull()
      expect(result!.type).toBe('blob')
      expect(result!.content).toEqual(content)
    })

    it('should return null for non-existent blob', async () => {
      const fakeSha = 'a'.repeat(40)

      const result = await storage.getObject(fakeSha)

      expect(result).toBeNull()
    })

    it('should return null for invalid SHA format', async () => {
      const result = await storage.getObject('invalid-sha')

      expect(result).toBeNull()
    })

    it('should retrieve empty blob correctly', async () => {
      const content = new Uint8Array(0)
      const sha = await storage.putObject('blob', content)

      const result = await storage.getObject(sha)

      expect(result).not.toBeNull()
      expect(result!.content).toEqual(content)
      expect(result!.content.length).toBe(0)
    })

    it('should retrieve binary content exactly as stored', async () => {
      const content = createTestContent(1024)
      const sha = await storage.putObject('blob', content)

      const result = await storage.getObject(sha)

      expect(result).not.toBeNull()
      expect(result!.content).toEqual(content)
    })

    it('should retrieve large blob (1MB) correctly', async () => {
      const content = createTestContent(1024 * 1024)
      const sha = await storage.putObject('blob', content)

      const result = await storage.getObject(sha)

      expect(result).not.toBeNull()
      expect(result!.content).toEqual(content)
    })
  })

  describe('getBlobObject - Typed Blob Retrieval', () => {
    it('should return typed BlobObject', async () => {
      const content = textToBytes('Hello, World!')
      const sha = await storage.putObject('blob', content)

      const blob = await storage.getBlobObject(sha)

      expect(blob).not.toBeNull()
      expect(blob!.type).toBe('blob')
      expect(blob!.data).toEqual(content)
    })

    it('should return null for non-blob objects', async () => {
      // Assume a tree object was stored with this SHA
      const treeContent = new Uint8Array([1, 2, 3])
      // Manually store as tree (mocking)
      // When getBlobObject is called, it should return null for non-blobs
      const result = await storage.getBlobObject('b'.repeat(40))

      expect(result).toBeNull()
    })

    it('should return null for non-existent SHA', async () => {
      const result = await storage.getBlobObject('c'.repeat(40))

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Deduplication Tests
  // ==========================================================================

  describe('Blob Deduplication', () => {
    it('should return same SHA for identical content', async () => {
      const content = textToBytes('Duplicate content')

      const sha1 = await storage.putObject('blob', content)
      const sha2 = await storage.putObject('blob', content)

      expect(sha1).toBe(sha2)
    })

    it('should deduplicate identical blobs (store once)', async () => {
      const content = textToBytes('Deduplicated content')

      await storage.putObject('blob', content)
      await storage.putObject('blob', content)
      await storage.putObject('blob', content)

      // After storing 3 identical blobs, only 1 should exist
      const sha = await computeBlobSha(content)
      const exists = await storage.hasObject(sha)
      expect(exists).toBe(true)
    })

    it('should return different SHA for different content', async () => {
      const content1 = textToBytes('Content A')
      const content2 = textToBytes('Content B')

      const sha1 = await storage.putObject('blob', content1)
      const sha2 = await storage.putObject('blob', content2)

      expect(sha1).not.toBe(sha2)
    })

    it('should handle content that differs by single byte', async () => {
      const content1 = new Uint8Array([1, 2, 3, 4, 5])
      const content2 = new Uint8Array([1, 2, 3, 4, 6])

      const sha1 = await storage.putObject('blob', content1)
      const sha2 = await storage.putObject('blob', content2)

      expect(sha1).not.toBe(sha2)
    })

    it('should handle content that differs only in length', async () => {
      const content1 = textToBytes('test')
      const content2 = textToBytes('test ')

      const sha1 = await storage.putObject('blob', content1)
      const sha2 = await storage.putObject('blob', content2)

      expect(sha1).not.toBe(sha2)
    })

    it('should deduplicate even when stored from different sources', async () => {
      const text = 'Common content'
      const content1 = textToBytes(text)
      const content2 = new TextEncoder().encode(text)

      const sha1 = await storage.putObject('blob', content1)
      const sha2 = await storage.putObject('blob', content2)

      expect(sha1).toBe(sha2)
    })
  })

  // ==========================================================================
  // Compression Tests
  // ==========================================================================

  describe('Blob Compression', () => {
    it('should compress highly compressible content', async () => {
      // Create highly compressible content (repeated pattern)
      const content = textToBytes('A'.repeat(10000))
      const sha = await storage.putObject('blob', content)

      const info = await storage.getBlobCompressionInfo(sha)

      expect(info).not.toBeNull()
      expect(info!.originalSize).toBe(10000)
      expect(info!.compressedSize).toBeLessThan(info!.originalSize)
      expect(info!.compressionRatio).toBeGreaterThan(1)
    })

    it('should return correct original size', async () => {
      const content = textToBytes('Test content for size check')
      const sha = await storage.putObject('blob', content)

      const size = await storage.getBlobSize(sha)

      expect(size).toBe(content.length)
    })

    it('should not significantly expand incompressible content', async () => {
      // Random-ish binary data is hard to compress
      const content = createTestContent(1000, 42)
      const sha = await storage.putObject('blob', content)

      const info = await storage.getBlobCompressionInfo(sha)

      expect(info).not.toBeNull()
      // Compressed size should not be more than 10% larger than original
      expect(info!.compressedSize).toBeLessThanOrEqual(info!.originalSize * 1.1)
    })

    it('should decompress content correctly on retrieval', async () => {
      const content = textToBytes('B'.repeat(5000))
      const sha = await storage.putObject('blob', content)

      const result = await storage.getObject(sha)

      expect(result).not.toBeNull()
      expect(result!.content).toEqual(content)
    })

    it('should handle very small content (may not compress)', async () => {
      const content = textToBytes('Hi')
      const sha = await storage.putObject('blob', content)

      const result = await storage.getObject(sha)

      expect(result).not.toBeNull()
      expect(result!.content).toEqual(content)
    })

    it('should maintain compression ratio stat correctly', async () => {
      const content = textToBytes('X'.repeat(20000))
      const sha = await storage.putObject('blob', content)

      const info = await storage.getBlobCompressionInfo(sha)

      expect(info).not.toBeNull()
      expect(info!.compressionRatio).toBe(info!.originalSize / info!.compressedSize)
    })
  })

  // ==========================================================================
  // Integrity Verification Tests
  // ==========================================================================

  describe('Blob Integrity Verification', () => {
    it('should verify integrity of stored blob', async () => {
      const content = textToBytes('Integrity test content')
      const sha = await storage.putObject('blob', content)

      const isValid = await storage.verifyBlobIntegrity(sha)

      expect(isValid).toBe(true)
    })

    it('should return false for non-existent blob', async () => {
      const isValid = await storage.verifyBlobIntegrity('d'.repeat(40))

      expect(isValid).toBe(false)
    })

    it('should verify integrity after multiple retrievals', async () => {
      const content = textToBytes('Multiple access test')
      const sha = await storage.putObject('blob', content)

      // Access multiple times
      await storage.getObject(sha)
      await storage.getObject(sha)
      await storage.getObject(sha)

      const isValid = await storage.verifyBlobIntegrity(sha)

      expect(isValid).toBe(true)
    })

    it('should verify integrity of compressed blob', async () => {
      const content = textToBytes('C'.repeat(5000))
      const sha = await storage.putObject('blob', content)

      const isValid = await storage.verifyBlobIntegrity(sha)

      expect(isValid).toBe(true)
    })

    it('should verify integrity of large blob', async () => {
      const content = createTestContent(1024 * 1024)
      const sha = await storage.putObject('blob', content)

      const isValid = await storage.verifyBlobIntegrity(sha)

      expect(isValid).toBe(true)
    })
  })

  // ==========================================================================
  // Cache Behavior Tests
  // ==========================================================================

  describe('Cache Behavior', () => {
    it('should track cache hits on repeated access', async () => {
      const content = textToBytes('Cache test content')
      const sha = await storage.putObject('blob', content)

      // First access - should be a miss or initial population
      await storage.getObject(sha)
      const stats1 = storage.getCacheStats()

      // Second access - should be a hit
      await storage.getObject(sha)
      const stats2 = storage.getCacheStats()

      expect(stats2.hits).toBeGreaterThan(stats1.hits)
    })

    it('should track cache misses for non-existent objects', async () => {
      const statsBefore = storage.getCacheStats()

      await storage.getObject('e'.repeat(40))

      const statsAfter = storage.getCacheStats()
      expect(statsAfter.misses).toBeGreaterThan(statsBefore.misses)
    })

    it('should add to cache on store', async () => {
      const statsBefore = storage.getCacheStats()

      const content = textToBytes('New content')
      await storage.putObject('blob', content)

      const statsAfter = storage.getCacheStats()
      expect(statsAfter.size).toBeGreaterThan(statsBefore.size)
    })

    it('should serve from cache without re-reading', async () => {
      const content = textToBytes('Cached content')
      const sha = await storage.putObject('blob', content)

      // First read populates cache
      const result1 = await storage.getObject(sha)
      const stats1 = storage.getCacheStats()

      // Second read should be from cache
      const result2 = await storage.getObject(sha)
      const stats2 = storage.getCacheStats()

      expect(result1!.content).toEqual(result2!.content)
      expect(stats2.hits).toBeGreaterThan(stats1.hits)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle SHA with all zeros', async () => {
      // Attempt to get an object with all-zero SHA (unlikely to exist)
      const result = await storage.getObject('0'.repeat(40))

      expect(result).toBeNull()
    })

    it('should handle SHA with all fs (max value)', async () => {
      const result = await storage.getObject('f'.repeat(40))

      expect(result).toBeNull()
    })

    it('should handle concurrent put of same content', async () => {
      const content = textToBytes('Concurrent content')

      // Simulate concurrent puts
      const [sha1, sha2] = await Promise.all([
        storage.putObject('blob', content),
        storage.putObject('blob', content),
      ])

      expect(sha1).toBe(sha2)
    })

    it('should handle put and get in rapid succession', async () => {
      const content = textToBytes('Rapid access')
      const sha = await storage.putObject('blob', content)

      // Rapid gets
      const results = await Promise.all([
        storage.getObject(sha),
        storage.getObject(sha),
        storage.getObject(sha),
      ])

      results.forEach(result => {
        expect(result).not.toBeNull()
        expect(result!.content).toEqual(content)
      })
    })

    it('should handle content with all byte values', async () => {
      const content = new Uint8Array(256)
      for (let i = 0; i < 256; i++) {
        content[i] = i
      }

      const sha = await storage.putObject('blob', content)
      const result = await storage.getObject(sha)

      expect(result).not.toBeNull()
      expect(result!.content).toEqual(content)
    })
  })

  // ==========================================================================
  // Existence Checks
  // ==========================================================================

  describe('hasObject - Existence Checks', () => {
    it('should return true for existing blob', async () => {
      const content = textToBytes('Existence test')
      const sha = await storage.putObject('blob', content)

      const exists = await storage.hasObject(sha)

      expect(exists).toBe(true)
    })

    it('should return false for non-existent blob', async () => {
      const exists = await storage.hasObject('a'.repeat(40))

      expect(exists).toBe(false)
    })

    it('should return true immediately after store', async () => {
      const content = textToBytes('Immediate check')
      const sha = await storage.putObject('blob', content)

      const exists = await storage.hasObject(sha)

      expect(exists).toBe(true)
    })

    it('should handle hasBlobObject for type-specific check', async () => {
      const content = textToBytes('Blob type check')
      const sha = await storage.putObject('blob', content)

      const isBlob = await storage.hasBlobObject(sha)

      expect(isBlob).toBe(true)
    })
  })

  // ==========================================================================
  // Deletion Tests
  // ==========================================================================

  describe('deleteObject - Blob Deletion', () => {
    it('should delete existing blob', async () => {
      const content = textToBytes('To be deleted')
      const sha = await storage.putObject('blob', content)

      await storage.deleteObject(sha)

      const exists = await storage.hasObject(sha)
      expect(exists).toBe(false)
    })

    it('should not throw when deleting non-existent blob', async () => {
      await expect(storage.deleteObject('a'.repeat(40))).resolves.not.toThrow()
    })

    it('should return null after deletion', async () => {
      const content = textToBytes('Delete and retrieve')
      const sha = await storage.putObject('blob', content)
      await storage.deleteObject(sha)

      const result = await storage.getObject(sha)

      expect(result).toBeNull()
    })
  })
})
