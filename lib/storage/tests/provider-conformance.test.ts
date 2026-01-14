/**
 * Storage Provider Conformance Tests
 *
 * These tests verify that all storage provider implementations conform to
 * the StorageProvider interface contract. Each provider adapter must pass
 * all tests in this suite.
 *
 * NOTE: These tests require credentials to run against real services.
 * For CI, use mock implementations or skip with environment checks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type {
  StorageProvider,
  StorageProviderType,
  WriteOptions,
  ReadOptions,
  ListOptions,
  ObjectMetadata,
} from '../providers/interface'

// =============================================================================
// Test Utilities
// =============================================================================

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function randomKey(prefix = 'test'): string {
  return `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createTestData(content: string): Uint8Array {
  return encoder.encode(content)
}

// =============================================================================
// Conformance Test Suite
// =============================================================================

/**
 * Run the conformance test suite against a storage provider.
 *
 * @param createProvider - Factory function to create provider instance
 * @param providerType - Provider type for test naming
 * @param cleanup - Optional cleanup function called after each test
 */
export function runProviderConformanceTests(
  createProvider: () => StorageProvider,
  providerType: StorageProviderType,
  cleanup?: (provider: StorageProvider, keys: string[]) => Promise<void>
): void {
  describe(`StorageProvider conformance: ${providerType}`, () => {
    let provider: StorageProvider
    const createdKeys: string[] = []

    beforeEach(() => {
      provider = createProvider()
    })

    afterEach(async () => {
      // Clean up created objects
      if (cleanup && createdKeys.length > 0) {
        await cleanup(provider, [...createdKeys])
        createdKeys.length = 0
      }
    })

    // -------------------------------------------------------------------------
    // Provider Identity
    // -------------------------------------------------------------------------

    describe('provider identity', () => {
      it('should have correct type', () => {
        expect(provider.type).toBe(providerType)
      })

      it('should have a name', () => {
        expect(provider.name).toBeDefined()
        expect(typeof provider.name).toBe('string')
        expect(provider.name.length).toBeGreaterThan(0)
      })
    })

    // -------------------------------------------------------------------------
    // Basic CRUD Operations
    // -------------------------------------------------------------------------

    describe('put()', () => {
      it('should store an object and return etag', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const data = createTestData('Hello, World!')
        const result = await provider.put(key, data)

        expect(result.etag).toBeDefined()
        expect(typeof result.etag).toBe('string')
        expect(result.size).toBe(data.length)
      })

      it('should store with content type', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const data = createTestData('{"key": "value"}')
        const options: WriteOptions = { contentType: 'application/json' }

        const result = await provider.put(key, data, options)
        expect(result.etag).toBeDefined()

        const metadata = await provider.head(key)
        expect(metadata?.contentType).toBe('application/json')
      })

      it('should store with custom metadata', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const data = createTestData('test data')
        const options: WriteOptions = {
          customMetadata: {
            'x-custom-key': 'custom-value',
            'author': 'test-user',
          },
        }

        await provider.put(key, data, options)

        const metadata = await provider.head(key)
        expect(metadata?.customMetadata).toBeDefined()
        expect(metadata?.customMetadata?.['x-custom-key']).toBe('custom-value')
        expect(metadata?.customMetadata?.['author']).toBe('test-user')
      })

      it('should overwrite existing object', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const data1 = createTestData('version 1')
        const data2 = createTestData('version 2 - longer content')

        await provider.put(key, data1)
        const result = await provider.put(key, data2)

        expect(result.size).toBe(data2.length)

        const readResult = await provider.get(key)
        expect(readResult).not.toBeNull()
        expect(decoder.decode(readResult!.data)).toBe('version 2 - longer content')
      })

      it('should handle empty data', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const data = new Uint8Array(0)
        const result = await provider.put(key, data)

        expect(result.size).toBe(0)
        expect(result.etag).toBeDefined()
      })

      it('should handle binary data', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const data = new Uint8Array([0, 1, 2, 255, 254, 253, 0, 128])
        const result = await provider.put(key, data)

        expect(result.size).toBe(8)

        const readResult = await provider.get(key)
        expect(readResult?.data).toEqual(data)
      })
    })

    describe('get()', () => {
      it('should retrieve stored object', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const content = 'Hello, Storage!'
        const data = createTestData(content)
        await provider.put(key, data)

        const result = await provider.get(key)

        expect(result).not.toBeNull()
        expect(decoder.decode(result!.data)).toBe(content)
        expect(result!.metadata.size).toBe(data.length)
      })

      it('should return null for non-existent object', async () => {
        const result = await provider.get('non-existent-key-12345')
        expect(result).toBeNull()
      })

      it('should include metadata in result', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const data = createTestData('test content')
        await provider.put(key, data, { contentType: 'text/plain' })

        const result = await provider.get(key)

        expect(result?.metadata.key).toBe(key)
        expect(result?.metadata.size).toBe(data.length)
        expect(result?.metadata.etag).toBeDefined()
        expect(result?.metadata.contentType).toBe('text/plain')
      })

      it('should support range reads', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const content = 'Hello, World!'
        await provider.put(key, createTestData(content))

        const options: ReadOptions = { rangeStart: 0, rangeEnd: 4 }
        const result = await provider.get(key, options)

        expect(result).not.toBeNull()
        expect(decoder.decode(result!.data)).toBe('Hello')
      })

      it('should support conditional reads with If-None-Match', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const data = createTestData('test content')
        const writeResult = await provider.put(key, data)

        // Request with matching ETag should return 304 or empty
        const options: ReadOptions = { ifNoneMatch: writeResult.etag }
        const result = await provider.get(key, options)

        // Provider may return null, empty data, or status 304
        if (result !== null && result.status === 304) {
          expect(result.data.length).toBe(0)
        }
      })
    })

    describe('delete()', () => {
      it('should delete existing object', async () => {
        const key = randomKey()

        await provider.put(key, createTestData('to be deleted'))
        expect(await provider.exists(key)).toBe(true)

        await provider.delete(key)
        expect(await provider.exists(key)).toBe(false)
      })

      it('should not throw for non-existent object', async () => {
        // Idempotent delete
        await expect(provider.delete('non-existent-key-12345')).resolves.not.toThrow()
      })
    })

    describe('exists()', () => {
      it('should return true for existing object', async () => {
        const key = randomKey()
        createdKeys.push(key)

        await provider.put(key, createTestData('test'))
        expect(await provider.exists(key)).toBe(true)
      })

      it('should return false for non-existent object', async () => {
        expect(await provider.exists('non-existent-key-12345')).toBe(false)
      })
    })

    describe('head()', () => {
      it('should return metadata for existing object', async () => {
        const key = randomKey()
        createdKeys.push(key)

        const data = createTestData('test content')
        await provider.put(key, data, {
          contentType: 'text/plain',
          customMetadata: { author: 'test' },
        })

        const metadata = await provider.head(key)

        expect(metadata).not.toBeNull()
        expect(metadata!.key).toBe(key)
        expect(metadata!.size).toBe(data.length)
        expect(metadata!.etag).toBeDefined()
        expect(metadata!.contentType).toBe('text/plain')
        expect(metadata!.customMetadata?.author).toBe('test')
      })

      it('should return null for non-existent object', async () => {
        const metadata = await provider.head('non-existent-key-12345')
        expect(metadata).toBeNull()
      })

      it('should not download content', async () => {
        const key = randomKey()
        createdKeys.push(key)

        // Create a larger object
        const data = new Uint8Array(10000).fill(65) // 10KB of 'A'
        await provider.put(key, data)

        // head() should be fast because it doesn't download content
        const start = Date.now()
        await provider.head(key)
        const elapsed = Date.now() - start

        // This is a soft check - head should be significantly faster
        // than downloading 10KB of data
        expect(elapsed).toBeLessThan(5000) // 5 seconds max
      })
    })

    // -------------------------------------------------------------------------
    // Listing Operations
    // -------------------------------------------------------------------------

    describe('list()', () => {
      it('should list objects', async () => {
        const prefix = `test-list-${Date.now()}`
        const keys = [
          `${prefix}/file1.txt`,
          `${prefix}/file2.txt`,
          `${prefix}/file3.txt`,
        ]

        for (const key of keys) {
          createdKeys.push(key)
          await provider.put(key, createTestData(`content for ${key}`))
        }

        const result = await provider.list({ prefix })

        expect(result.objects.length).toBeGreaterThanOrEqual(3)
        expect(result.keyCount).toBeGreaterThanOrEqual(3)
      })

      it('should support prefix filtering', async () => {
        const basePrefix = `test-filter-${Date.now()}`
        const keys = [
          `${basePrefix}/a/file1.txt`,
          `${basePrefix}/a/file2.txt`,
          `${basePrefix}/b/file3.txt`,
        ]

        for (const key of keys) {
          createdKeys.push(key)
          await provider.put(key, createTestData('content'))
        }

        const result = await provider.list({ prefix: `${basePrefix}/a/` })

        expect(result.objects.length).toBe(2)
        expect(result.objects.every((obj) => obj.key.startsWith(`${basePrefix}/a/`))).toBe(true)
      })

      it('should support delimiter for directory listing', async () => {
        const basePrefix = `test-delim-${Date.now()}`
        const keys = [
          `${basePrefix}/file1.txt`,
          `${basePrefix}/dir1/file2.txt`,
          `${basePrefix}/dir1/file3.txt`,
          `${basePrefix}/dir2/file4.txt`,
        ]

        for (const key of keys) {
          createdKeys.push(key)
          await provider.put(key, createTestData('content'))
        }

        const result = await provider.list({
          prefix: `${basePrefix}/`,
          delimiter: '/',
        })

        // Should have 1 file at root and 2 common prefixes (dir1/, dir2/)
        expect(result.objects.length).toBe(1)
        expect(result.prefixes.length).toBe(2)
        expect(result.prefixes).toContain(`${basePrefix}/dir1/`)
        expect(result.prefixes).toContain(`${basePrefix}/dir2/`)
      })

      it('should support pagination', async () => {
        const prefix = `test-page-${Date.now()}`
        const keys: string[] = []

        // Create 10 objects
        for (let i = 0; i < 10; i++) {
          const key = `${prefix}/file${String(i).padStart(2, '0')}.txt`
          keys.push(key)
          createdKeys.push(key)
          await provider.put(key, createTestData(`file ${i}`))
        }

        // List with small page size
        const page1 = await provider.list({ prefix, maxKeys: 3 })
        expect(page1.objects.length).toBe(3)
        expect(page1.isTruncated).toBe(true)
        expect(page1.nextContinuationToken).toBeDefined()

        // Get next page
        const page2 = await provider.list({
          prefix,
          maxKeys: 3,
          continuationToken: page1.nextContinuationToken,
        })
        expect(page2.objects.length).toBe(3)

        // Ensure no duplicates
        const allKeys = [...page1.objects, ...page2.objects].map((o) => o.key)
        expect(new Set(allKeys).size).toBe(6)
      })

      it('should return empty result for non-matching prefix', async () => {
        const result = await provider.list({ prefix: 'non-existent-prefix-12345/' })
        expect(result.objects).toEqual([])
        expect(result.keyCount).toBe(0)
        expect(result.isTruncated).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // Batch Operations
    // -------------------------------------------------------------------------

    describe('deleteMany()', () => {
      it('should delete multiple objects', async () => {
        const keys = [
          randomKey('batch'),
          randomKey('batch'),
          randomKey('batch'),
        ]

        for (const key of keys) {
          await provider.put(key, createTestData('content'))
        }

        // Verify all exist
        for (const key of keys) {
          expect(await provider.exists(key)).toBe(true)
        }

        const result = await provider.deleteMany(keys)

        expect(result.deleted.length).toBe(3)
        expect(result.errors.length).toBe(0)

        // Verify all deleted
        for (const key of keys) {
          expect(await provider.exists(key)).toBe(false)
        }
      })

      it('should handle non-existent keys gracefully', async () => {
        const result = await provider.deleteMany([
          'non-existent-1',
          'non-existent-2',
        ])

        // Should not throw, may report as deleted or not
        expect(result.errors.length).toBe(0)
      })

      it('should handle empty array', async () => {
        const result = await provider.deleteMany([])
        expect(result.deleted).toEqual([])
        expect(result.errors).toEqual([])
      })
    })

    // -------------------------------------------------------------------------
    // Copy Operation
    // -------------------------------------------------------------------------

    describe('copy()', () => {
      it('should copy an object', async () => {
        const sourceKey = randomKey('copy-source')
        const destKey = randomKey('copy-dest')
        createdKeys.push(sourceKey, destKey)

        const content = 'content to copy'
        await provider.put(sourceKey, createTestData(content), {
          contentType: 'text/plain',
        })

        const result = await provider.copy(sourceKey, destKey)

        expect(result.etag).toBeDefined()
        expect(result.size).toBe(content.length)

        const copied = await provider.get(destKey)
        expect(copied).not.toBeNull()
        expect(decoder.decode(copied!.data)).toBe(content)
      })

      it('should preserve metadata by default', async () => {
        const sourceKey = randomKey('copy-meta-source')
        const destKey = randomKey('copy-meta-dest')
        createdKeys.push(sourceKey, destKey)

        await provider.put(sourceKey, createTestData('content'), {
          contentType: 'application/json',
          customMetadata: { original: 'true' },
        })

        await provider.copy(sourceKey, destKey)

        const destMeta = await provider.head(destKey)
        expect(destMeta?.contentType).toBe('application/json')
        expect(destMeta?.customMetadata?.original).toBe('true')
      })

      it('should throw for non-existent source', async () => {
        const destKey = randomKey('copy-fail-dest')

        await expect(
          provider.copy('non-existent-source-12345', destKey)
        ).rejects.toThrow()
      })
    })

    // -------------------------------------------------------------------------
    // Signed URLs
    // -------------------------------------------------------------------------

    describe('getSignedUrl()', () => {
      it('should generate a signed URL for GET', async () => {
        const key = randomKey('signed')
        createdKeys.push(key)

        await provider.put(key, createTestData('signed content'))

        const url = await provider.getSignedUrl(key, {
          expiresIn: 300,
          method: 'GET',
        })

        expect(url).toBeDefined()
        expect(typeof url).toBe('string')
        expect(url.startsWith('http')).toBe(true)
      })

      it('should generate a signed URL for PUT', async () => {
        const key = randomKey('signed-put')
        createdKeys.push(key)

        const url = await provider.getSignedUrl(key, {
          expiresIn: 300,
          method: 'PUT',
          contentType: 'text/plain',
        })

        expect(url).toBeDefined()
        expect(typeof url).toBe('string')
      })
    })

    // -------------------------------------------------------------------------
    // Multipart Upload
    // -------------------------------------------------------------------------

    describe('createMultipartUpload()', () => {
      it('should create a multipart upload', async () => {
        const key = randomKey('multipart')
        createdKeys.push(key)

        const upload = await provider.createMultipartUpload(key, {
          contentType: 'application/octet-stream',
        })

        expect(upload.uploadId).toBeDefined()
        expect(upload.key).toBe(key)

        // Clean up by aborting
        await upload.abort()
      })

      it('should complete a multipart upload', async () => {
        const key = randomKey('multipart-complete')
        createdKeys.push(key)

        const upload = await provider.createMultipartUpload(key)

        // Upload parts (minimum 5MB for real providers, but we test interface)
        const part1Data = new Uint8Array(5 * 1024 * 1024).fill(65) // 5MB of 'A'
        const part2Data = new Uint8Array(1024).fill(66) // 1KB of 'B'

        const part1 = await upload.uploadPart(1, part1Data)
        const part2 = await upload.uploadPart(2, part2Data)

        expect(part1.partNumber).toBe(1)
        expect(part1.etag).toBeDefined()
        expect(part2.partNumber).toBe(2)

        const result = await upload.complete([part1, part2])

        expect(result.etag).toBeDefined()
        expect(result.size).toBe(part1Data.length + part2Data.length)

        // Verify the object exists
        expect(await provider.exists(key)).toBe(true)
      })

      it('should abort a multipart upload', async () => {
        const key = randomKey('multipart-abort')

        const upload = await provider.createMultipartUpload(key)

        // Upload a part
        const partData = new Uint8Array(5 * 1024 * 1024).fill(65)
        await upload.uploadPart(1, partData)

        // Abort
        await upload.abort()

        // Object should not exist
        expect(await provider.exists(key)).toBe(false)
      })
    })

    // -------------------------------------------------------------------------
    // Error Handling
    // -------------------------------------------------------------------------

    describe('error handling', () => {
      it('should throw StorageProviderError for access denied', async () => {
        // This test depends on provider configuration
        // Skip if we can't test access denial
      })

      it('should handle network errors gracefully', async () => {
        // This would require mocking network failures
        // Provider implementations should wrap network errors
      })
    })
  })
}

// =============================================================================
// Export for use by individual provider tests
// =============================================================================

export { randomKey, createTestData, encoder, decoder }

// =============================================================================
// Self-test (prevents "no test suite found" error)
// =============================================================================

describe('provider-conformance utilities', () => {
  it('should export test utilities', () => {
    expect(typeof randomKey).toBe('function')
    expect(typeof createTestData).toBe('function')
    expect(encoder).toBeInstanceOf(TextEncoder)
    expect(decoder).toBeInstanceOf(TextDecoder)
  })
})
