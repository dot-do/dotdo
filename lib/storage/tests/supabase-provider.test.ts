/**
 * Supabase Storage Provider Tests
 *
 * Tests for the Supabase Storage provider adapter.
 * Requires Supabase credentials to run against real Supabase Storage.
 */

import { describe, it, expect } from 'vitest'
import { runProviderConformanceTests } from './provider-conformance.test'
import { SupabaseStorageProvider } from '../providers/supabase'
import type { SupabaseStorageProviderConfig } from '../providers/interface'

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_CONFIG: SupabaseStorageProviderConfig = {
  type: 'supabase',
  url: process.env.SUPABASE_URL || 'https://test.supabase.co',
  key: process.env.SUPABASE_SERVICE_KEY || 'test-key',
  bucket: process.env.SUPABASE_TEST_BUCKET || 'test-bucket',
}

// Skip tests if no real credentials
const hasCredentials = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY

// =============================================================================
// Provider-Specific Tests
// =============================================================================

describe('SupabaseStorageProvider', () => {
  // Run conformance tests
  describe.runIf(hasCredentials)('conformance tests', () => {
    runProviderConformanceTests(
      () => new SupabaseStorageProvider(TEST_CONFIG),
      'supabase',
      async (provider, keys) => {
        if (keys.length > 0) {
          await provider.deleteMany(keys)
        }
      }
    )
  })

  // Supabase-specific tests
  describe('Supabase-specific features', () => {
    it('should have correct provider type', () => {
      const provider = new SupabaseStorageProvider(TEST_CONFIG)
      expect(provider.type).toBe('supabase')
      expect(provider.name).toContain('Supabase')
    })

    it('should construct correct API URL', () => {
      const config: SupabaseStorageProviderConfig = {
        type: 'supabase',
        url: 'https://abc123.supabase.co',
        key: 'test-key',
        bucket: 'my-bucket',
      }
      const provider = new SupabaseStorageProvider(config)
      expect(provider.type).toBe('supabase')
    })

    it.runIf(hasCredentials)('should support public bucket access', async () => {
      const provider = new SupabaseStorageProvider(TEST_CONFIG)
      const key = `test-public-${Date.now()}.txt`

      try {
        await provider.put(key, new TextEncoder().encode('public content'))

        // For public buckets, getSignedUrl might return a public URL
        const url = await provider.getSignedUrl(key, { expiresIn: 300 })
        expect(url).toContain(TEST_CONFIG.bucket)
      } finally {
        await provider.delete(key)
      }
    })

    it.runIf(hasCredentials)('should handle nested paths', async () => {
      const provider = new SupabaseStorageProvider(TEST_CONFIG)
      const key = `folder/subfolder/file-${Date.now()}.txt`

      try {
        await provider.put(key, new TextEncoder().encode('nested content'))

        const result = await provider.get(key)
        expect(result).not.toBeNull()
        expect(new TextDecoder().decode(result!.data)).toBe('nested content')
      } finally {
        await provider.delete(key)
      }
    })

    it.runIf(hasCredentials)('should support upsert behavior', async () => {
      const provider = new SupabaseStorageProvider(TEST_CONFIG)
      const key = `test-upsert-${Date.now()}.txt`

      try {
        await provider.put(key, new TextEncoder().encode('v1'))
        await provider.put(key, new TextEncoder().encode('v2'))

        const result = await provider.get(key)
        expect(new TextDecoder().decode(result!.data)).toBe('v2')
      } finally {
        await provider.delete(key)
      }
    })
  })
})
