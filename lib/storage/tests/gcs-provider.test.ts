/**
 * Google Cloud Storage Provider Tests
 *
 * Tests for the GCS storage provider adapter.
 * Requires GCP credentials to run against real GCS.
 */

import { describe, it, expect } from 'vitest'
import { runProviderConformanceTests } from './provider-conformance.test'
import { GCSProvider } from '../providers/gcs'
import type { GCSProviderConfig } from '../providers/interface'

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_CONFIG: GCSProviderConfig = {
  type: 'gcs',
  bucket: process.env.GCS_TEST_BUCKET || 'dotdo-test-bucket',
  credentials: process.env.GCS_CREDENTIALS || '{}',
  projectId: process.env.GCS_PROJECT_ID,
}

// Skip tests if no real credentials
const hasCredentials = process.env.GCS_CREDENTIALS && process.env.GCS_TEST_BUCKET

// =============================================================================
// Provider-Specific Tests
// =============================================================================

describe('GCSProvider', () => {
  // Run conformance tests
  describe.runIf(hasCredentials)('conformance tests', () => {
    runProviderConformanceTests(
      () => new GCSProvider(TEST_CONFIG),
      'gcs',
      async (provider, keys) => {
        if (keys.length > 0) {
          await provider.deleteMany(keys)
        }
      }
    )
  })

  // GCS-specific tests
  describe('GCS-specific features', () => {
    it('should have correct provider type', () => {
      const provider = new GCSProvider(TEST_CONFIG)
      expect(provider.type).toBe('gcs')
      expect(provider.name).toContain('Google Cloud Storage')
    })

    it('should parse JSON credentials', () => {
      const config: GCSProviderConfig = {
        ...TEST_CONFIG,
        credentials: JSON.stringify({
          type: 'service_account',
          project_id: 'test-project',
          private_key: 'fake-key',
          client_email: 'test@test.iam.gserviceaccount.com',
        }),
      }
      const provider = new GCSProvider(config)
      expect(provider.type).toBe('gcs')
    })

    it('should accept credentials object', () => {
      const config: GCSProviderConfig = {
        ...TEST_CONFIG,
        credentials: {
          type: 'service_account',
          project_id: 'test-project',
          private_key: 'fake-key',
          client_email: 'test@test.iam.gserviceaccount.com',
        },
      }
      const provider = new GCSProvider(config)
      expect(provider.type).toBe('gcs')
    })

    it.runIf(hasCredentials)('should support GCS storage classes', async () => {
      const provider = new GCSProvider(TEST_CONFIG)
      const key = `test-storage-class-${Date.now()}`

      try {
        await provider.put(key, new TextEncoder().encode('test'), {
          storageClass: 'NEARLINE',
        })

        const metadata = await provider.head(key)
        expect(metadata?.storageClass).toBe('NEARLINE')
      } finally {
        await provider.delete(key)
      }
    })

    it.runIf(hasCredentials)('should support uniform bucket-level access', async () => {
      const provider = new GCSProvider(TEST_CONFIG)
      const key = `test-uniform-${Date.now()}`

      try {
        // GCS with uniform access shouldn't have per-object ACLs
        await provider.put(key, new TextEncoder().encode('test'))
        const metadata = await provider.head(key)
        expect(metadata).not.toBeNull()
      } finally {
        await provider.delete(key)
      }
    })
  })
})
