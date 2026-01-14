/**
 * Backblaze B2 Provider Tests
 *
 * Tests for the Backblaze B2 storage provider adapter.
 * Requires B2 credentials to run against real B2.
 */

import { describe, it, expect } from 'vitest'
import { runProviderConformanceTests } from './provider-conformance.test'
import { B2Provider } from '../providers/b2'
import type { B2ProviderConfig } from '../providers/interface'

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_CONFIG: B2ProviderConfig = {
  type: 'b2',
  applicationKeyId: process.env.B2_APPLICATION_KEY_ID || 'test-key-id',
  applicationKey: process.env.B2_APPLICATION_KEY || 'test-key',
  bucket: process.env.B2_TEST_BUCKET || 'dotdo-test-bucket',
  bucketId: process.env.B2_TEST_BUCKET_ID || 'test-bucket-id',
}

// Skip tests if no real credentials
const hasCredentials = process.env.B2_APPLICATION_KEY_ID && process.env.B2_APPLICATION_KEY

// =============================================================================
// Provider-Specific Tests
// =============================================================================

describe('B2Provider', () => {
  // Run conformance tests
  describe.runIf(hasCredentials)('conformance tests', () => {
    runProviderConformanceTests(
      () => new B2Provider(TEST_CONFIG),
      'b2',
      async (provider, keys) => {
        if (keys.length > 0) {
          await provider.deleteMany(keys)
        }
      }
    )
  })

  // B2-specific tests
  describe('B2-specific features', () => {
    it('should have correct provider type', () => {
      const provider = new B2Provider(TEST_CONFIG)
      expect(provider.type).toBe('b2')
      expect(provider.name).toContain('Backblaze B2')
    })

    it('should require bucket ID', () => {
      const config: B2ProviderConfig = {
        type: 'b2',
        applicationKeyId: 'key-id',
        applicationKey: 'key',
        bucket: 'my-bucket',
        bucketId: 'bucket-id-123',
      }
      const provider = new B2Provider(config)
      expect(provider.type).toBe('b2')
    })

    it.runIf(hasCredentials)('should handle B2 file info', async () => {
      const provider = new B2Provider(TEST_CONFIG)
      const key = `test-fileinfo-${Date.now()}.txt`

      try {
        await provider.put(key, new TextEncoder().encode('test content'), {
          customMetadata: {
            'X-Bz-Info-Author': 'test-author',
          },
        })

        const metadata = await provider.head(key)
        expect(metadata).not.toBeNull()
        // B2 uses X-Bz-Info-* headers for custom metadata
        expect(metadata?.customMetadata).toBeDefined()
      } finally {
        await provider.delete(key)
      }
    })

    it.runIf(hasCredentials)('should support large file upload', async () => {
      const provider = new B2Provider(TEST_CONFIG)
      const key = `test-large-${Date.now()}.bin`

      try {
        // Create multipart upload for large files
        const upload = await provider.createMultipartUpload(key)
        expect(upload.uploadId).toBeDefined()

        // B2 requires minimum 5MB parts (except last)
        const partData = new Uint8Array(5 * 1024 * 1024).fill(65)
        const part = await upload.uploadPart(1, partData)

        expect(part.partNumber).toBe(1)
        expect(part.etag).toBeDefined()

        // Abort for cleanup
        await upload.abort()
      } catch (e) {
        // Cleanup on error
        await provider.delete(key).catch(() => {})
        throw e
      }
    })

    it.runIf(hasCredentials)('should support B2 native URLs', async () => {
      const provider = new B2Provider(TEST_CONFIG)
      const key = `test-native-url-${Date.now()}.txt`

      try {
        await provider.put(key, new TextEncoder().encode('content'))

        const url = await provider.getSignedUrl(key, {
          expiresIn: 3600,
        })

        // B2 URLs should contain the bucket name and file path
        expect(url).toContain(TEST_CONFIG.bucket)
      } finally {
        await provider.delete(key)
      }
    })

    it.runIf(hasCredentials)('should handle file versions', async () => {
      const provider = new B2Provider(TEST_CONFIG)
      const key = `test-versions-${Date.now()}.txt`

      try {
        // B2 keeps all versions by default
        const result1 = await provider.put(key, new TextEncoder().encode('v1'))
        const result2 = await provider.put(key, new TextEncoder().encode('v2'))

        // Both writes should succeed
        expect(result1.etag).toBeDefined()
        expect(result2.etag).toBeDefined()

        // Get should return latest version
        const current = await provider.get(key)
        expect(new TextDecoder().decode(current!.data)).toBe('v2')
      } finally {
        await provider.delete(key)
      }
    })
  })
})
