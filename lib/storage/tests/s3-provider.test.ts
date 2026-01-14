/**
 * AWS S3 Provider Tests
 *
 * Tests for the S3 storage provider adapter.
 * Requires AWS credentials to run against real S3.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runProviderConformanceTests } from './provider-conformance.test'
import { S3Provider } from '../providers/s3'
import type { S3ProviderConfig } from '../providers/interface'

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_CONFIG: S3ProviderConfig = {
  type: 's3',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test-key',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test-secret',
  bucket: process.env.AWS_S3_TEST_BUCKET || 'dotdo-test-bucket',
  region: process.env.AWS_REGION || 'us-east-1',
}

// Skip tests if no real credentials
const hasCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY

// =============================================================================
// Provider-Specific Tests
// =============================================================================

describe('S3Provider', () => {
  // Run conformance tests
  describe.runIf(hasCredentials)('conformance tests', () => {
    runProviderConformanceTests(
      () => new S3Provider(TEST_CONFIG),
      's3',
      async (provider, keys) => {
        // Cleanup created objects
        if (keys.length > 0) {
          await provider.deleteMany(keys)
        }
      }
    )
  })

  // S3-specific tests
  describe('S3-specific features', () => {
    it('should have correct provider type', () => {
      const provider = new S3Provider(TEST_CONFIG)
      expect(provider.type).toBe('s3')
      expect(provider.name).toContain('S3')
    })

    it('should support custom endpoint', () => {
      const config: S3ProviderConfig = {
        ...TEST_CONFIG,
        endpoint: 'https://s3.custom.endpoint.com',
        forcePathStyle: true,
      }
      const provider = new S3Provider(config)
      expect(provider.type).toBe('s3')
    })

    it.runIf(hasCredentials)('should support storage classes', async () => {
      const provider = new S3Provider(TEST_CONFIG)
      const key = `test-storage-class-${Date.now()}`

      try {
        await provider.put(key, new TextEncoder().encode('test'), {
          storageClass: 'STANDARD_IA',
        })

        const metadata = await provider.head(key)
        expect(metadata?.storageClass).toBe('STANDARD_IA')
      } finally {
        await provider.delete(key)
      }
    })

    it.runIf(hasCredentials)('should handle versioned buckets', async () => {
      const provider = new S3Provider(TEST_CONFIG)
      const key = `test-versioning-${Date.now()}`

      try {
        const result1 = await provider.put(key, new TextEncoder().encode('v1'))
        const result2 = await provider.put(key, new TextEncoder().encode('v2'))

        // If versioning is enabled, versionIds should differ
        if (result1.versionId && result2.versionId) {
          expect(result1.versionId).not.toBe(result2.versionId)
        }
      } finally {
        await provider.delete(key)
      }
    })
  })
})
