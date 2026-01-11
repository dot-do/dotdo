import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * DO Location Caching Tests (RED Phase)
 *
 * Issue: dotdo-4cgch - DO location caching
 *
 * Once a DO detects its location, it should cache it in DO storage since
 * the location never changes for a given DO instance.
 *
 * These tests verify:
 * - LocationCache class for get/set/has/clear operations
 * - getOrDetectLocation() function for cached location retrieval
 * - Storage key constants for consistent storage access
 *
 * TDD RED Phase: These tests should FAIL initially with NOT IMPLEMENTED errors
 */

// ============================================================================
// Import the modules under test (will fail until implemented)
// ============================================================================

import {
  LocationCache,
  getOrDetectLocation,
  LOCATION_STORAGE_KEY,
  LOCATION_CACHE_VERSION,
} from '../caching'

import type { DOLocation } from '../caching'

// ============================================================================
// Mock Detection Module
// ============================================================================

/**
 * Mock fetchDOLocation to avoid network calls during caching tests.
 * Returns a mock location that matches the expected DOLocation format.
 */
vi.mock('../detection', () => ({
  fetchDOLocation: vi.fn().mockResolvedValue({
    colo: 'sjc',
    ip: '192.0.2.1',
    loc: 'US',
    detectedAt: new Date('2024-01-15T10:30:00Z'),
    traceData: {
      fl: 'test',
      h: 'cloudflare.com',
      ip: '192.0.2.1',
      ts: '1705315800',
      visit_scheme: 'https',
      uag: 'test',
      colo: 'SJC',
      sliver: 'none',
      http: 'h2',
      loc: 'US',
      tls: 'TLSv1.3',
      sni: 'on',
      warp: 'off',
      gateway: 'off',
      rbi: 'off',
      kex: 'X25519',
    },
  }),
}))

// ============================================================================
// Mock DurableObjectStorage
// ============================================================================

/**
 * Mock DurableObjectStorage for testing location cache operations
 */
class MockDurableObjectStorage {
  private data = new Map<string, unknown>()
  private getCallCount = 0
  private putCallCount = 0
  private deleteCallCount = 0

  async get<T = unknown>(key: string): Promise<T | undefined> {
    this.getCallCount++
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.putCallCount++
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    this.deleteCallCount++
    return this.data.delete(key)
  }

  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const [key, value] of this.data) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T)
      }
    }
    return result
  }

  // Test helpers
  _clear(): void {
    this.data.clear()
    this.getCallCount = 0
    this.putCallCount = 0
    this.deleteCallCount = 0
  }

  _getCallCount(): number {
    return this.getCallCount
  }

  _putCallCount(): number {
    return this.putCallCount
  }

  _deleteCallCount(): number {
    return this.deleteCallCount
  }

  _getRawData(): Map<string, unknown> {
    return new Map(this.data)
  }

  _setRawData(key: string, value: unknown): void {
    this.data.set(key, value)
  }
}

/**
 * Create a mock storage instance typed as DurableObjectStorage
 */
function createMockStorage(): MockDurableObjectStorage & DurableObjectStorage {
  return new MockDurableObjectStorage() as MockDurableObjectStorage & DurableObjectStorage
}

// ============================================================================
// Sample DOLocation Data
// ============================================================================

const sampleLocation: DOLocation = {
  colo: 'lax',
  region: 'us-west',
  city: 'LosAngeles',
  cfHint: 'wnam',
  detectedAt: new Date('2024-01-15T10:30:00Z'),
}

const alternateLocation: DOLocation = {
  colo: 'iad',
  region: 'us-east',
  city: 'Virginia',
  cfHint: 'enam',
  detectedAt: new Date('2024-01-15T11:00:00Z'),
}

// ============================================================================
// Storage Key Constants Tests
// ============================================================================

describe('Storage Key Constants', () => {
  it('should export LOCATION_STORAGE_KEY as "do:location"', () => {
    expect(LOCATION_STORAGE_KEY).toBe('do:location')
  })

  it('should export LOCATION_CACHE_VERSION as 1', () => {
    expect(LOCATION_CACHE_VERSION).toBe(1)
  })
})

// ============================================================================
// LocationCache Class Tests
// ============================================================================

describe('LocationCache', () => {
  let storage: MockDurableObjectStorage & DurableObjectStorage
  let cache: LocationCache

  beforeEach(() => {
    storage = createMockStorage()
    cache = new LocationCache(storage)
  })

  describe('constructor', () => {
    it('should accept DurableObjectStorage as parameter', () => {
      const cache = new LocationCache(storage)
      expect(cache).toBeInstanceOf(LocationCache)
    })
  })

  describe('get()', () => {
    it('should return null when no location is cached', async () => {
      const result = await cache.get()
      expect(result).toBeNull()
    })

    it('should return cached location when present', async () => {
      // Pre-populate storage with location data
      storage._setRawData(LOCATION_STORAGE_KEY, sampleLocation)

      const result = await cache.get()
      expect(result).toEqual(sampleLocation)
    })

    it('should deserialize DOLocation correctly from storage', async () => {
      // Store as serialized format
      storage._setRawData(LOCATION_STORAGE_KEY, {
        colo: 'lax',
        region: 'us-west',
        city: 'LosAngeles',
        cfHint: 'wnam',
        detectedAt: '2024-01-15T10:30:00.000Z', // ISO string format
      })

      const result = await cache.get()

      expect(result).not.toBeNull()
      expect(result!.colo).toBe('lax')
      expect(result!.region).toBe('us-west')
      expect(result!.city).toBe('LosAngeles')
      expect(result!.cfHint).toBe('wnam')
      expect(result!.detectedAt).toBeInstanceOf(Date)
    })

    it('should use consistent storage key "do:location"', async () => {
      await cache.get()

      // Verify the storage was queried with the correct key
      const rawData = storage._getRawData()
      // If nothing was stored, just verify get was called
      expect(storage._getCallCount()).toBeGreaterThanOrEqual(1)
    })
  })

  describe('set()', () => {
    it('should cache location in storage', async () => {
      await cache.set(sampleLocation)

      const storedValue = storage._getRawData().get(LOCATION_STORAGE_KEY)
      expect(storedValue).toBeDefined()
    })

    it('should return the location that was set', async () => {
      const result = await cache.set(sampleLocation)

      expect(result).toEqual(sampleLocation)
    })

    it('should serialize DOLocation correctly for storage', async () => {
      await cache.set(sampleLocation)

      const storedValue = storage._getRawData().get(LOCATION_STORAGE_KEY) as Record<string, unknown>
      expect(storedValue.colo).toBe('lax')
      expect(storedValue.region).toBe('us-west')
      expect(storedValue.city).toBe('LosAngeles')
      expect(storedValue.cfHint).toBe('wnam')
    })

    it('should use consistent storage key "do:location"', async () => {
      await cache.set(sampleLocation)

      expect(storage._getRawData().has(LOCATION_STORAGE_KEY)).toBe(true)
    })

    it('should not overwrite existing location (immutable per DO)', async () => {
      // First set
      await cache.set(sampleLocation)

      // Attempt to overwrite with different location
      await cache.set(alternateLocation)

      // Should still have original location
      const storedValue = storage._getRawData().get(LOCATION_STORAGE_KEY) as DOLocation
      expect(storedValue.colo).toBe('lax')
      expect(storedValue.city).toBe('LosAngeles')
    })

    it('should return original location when attempting to overwrite', async () => {
      await cache.set(sampleLocation)

      const result = await cache.set(alternateLocation)

      // Should return the original, not the new one
      expect(result.colo).toBe('lax')
      expect(result.city).toBe('LosAngeles')
    })
  })

  describe('has()', () => {
    it('should return false when no location is cached', async () => {
      const result = await cache.has()
      expect(result).toBe(false)
    })

    it('should return true when location is cached', async () => {
      storage._setRawData(LOCATION_STORAGE_KEY, sampleLocation)

      const result = await cache.has()
      expect(result).toBe(true)
    })

    it('should check the correct storage key', async () => {
      storage._setRawData('wrong:key', sampleLocation)

      const result = await cache.has()
      expect(result).toBe(false)
    })
  })

  describe('clear()', () => {
    it('should remove cached location', async () => {
      storage._setRawData(LOCATION_STORAGE_KEY, sampleLocation)

      await cache.clear()

      expect(storage._getRawData().has(LOCATION_STORAGE_KEY)).toBe(false)
    })

    it('should not throw when no location is cached', async () => {
      await expect(cache.clear()).resolves.not.toThrow()
    })

    it('should make get() return null after clear', async () => {
      storage._setRawData(LOCATION_STORAGE_KEY, sampleLocation)

      await cache.clear()
      const result = await cache.get()

      expect(result).toBeNull()
    })

    it('should make has() return false after clear', async () => {
      storage._setRawData(LOCATION_STORAGE_KEY, sampleLocation)

      await cache.clear()
      const result = await cache.has()

      expect(result).toBe(false)
    })
  })

  describe('serialization round-trip', () => {
    it('should correctly serialize and deserialize DOLocation', async () => {
      // Set location
      await cache.set(sampleLocation)

      // Create new cache instance with same storage
      const newCache = new LocationCache(storage)
      const result = await newCache.get()

      expect(result).not.toBeNull()
      expect(result!.colo).toBe(sampleLocation.colo)
      expect(result!.region).toBe(sampleLocation.region)
      expect(result!.city).toBe(sampleLocation.city)
      expect(result!.cfHint).toBe(sampleLocation.cfHint)
    })

    it('should preserve Date objects through serialization', async () => {
      await cache.set(sampleLocation)

      const newCache = new LocationCache(storage)
      const result = await newCache.get()

      expect(result!.detectedAt).toBeInstanceOf(Date)
      expect(result!.detectedAt.toISOString()).toBe('2024-01-15T10:30:00.000Z')
    })
  })
})

// ============================================================================
// getOrDetectLocation() Function Tests
// ============================================================================

describe('getOrDetectLocation()', () => {
  let storage: MockDurableObjectStorage & DurableObjectStorage

  beforeEach(() => {
    storage = createMockStorage()
  })

  describe('cached location', () => {
    it('should return cached location if exists', async () => {
      storage._setRawData(LOCATION_STORAGE_KEY, sampleLocation)

      const result = await getOrDetectLocation(storage)

      expect(result.colo).toBe('lax')
      expect(result.region).toBe('us-west')
    })

    it('should not trigger detection if location is cached', async () => {
      storage._setRawData(LOCATION_STORAGE_KEY, sampleLocation)

      // Detection would involve additional storage writes or external calls
      const initialPutCount = storage._putCallCount()

      await getOrDetectLocation(storage)

      // Should not have written anything new
      expect(storage._putCallCount()).toBe(initialPutCount)
    })
  })

  describe('detection when not cached', () => {
    it('should detect location if not cached', async () => {
      const result = await getOrDetectLocation(storage)

      expect(result).toBeDefined()
      expect(result.colo).toBeDefined()
      expect(result.region).toBeDefined()
    })

    it('should cache detected location', async () => {
      await getOrDetectLocation(storage)

      expect(storage._getRawData().has(LOCATION_STORAGE_KEY)).toBe(true)
    })

    it('should return DOLocation with all required fields', async () => {
      const result = await getOrDetectLocation(storage)

      expect(result.colo).toBeDefined()
      expect(result.region).toBeDefined()
      expect(result.city).toBeDefined()
      expect(result.cfHint).toBeDefined()
      expect(result.detectedAt).toBeInstanceOf(Date)
    })
  })

  describe('detection optimization', () => {
    it('should only detect once per DO lifetime', async () => {
      // First call - should detect
      await getOrDetectLocation(storage)
      const firstPutCount = storage._putCallCount()

      // Second call - should use cache
      await getOrDetectLocation(storage)
      const secondPutCount = storage._putCallCount()

      // Should not have additional writes after first detection
      expect(secondPutCount).toBe(firstPutCount)
    })

    it('should return same location on subsequent calls', async () => {
      const first = await getOrDetectLocation(storage)
      const second = await getOrDetectLocation(storage)

      expect(first.colo).toBe(second.colo)
      expect(first.region).toBe(second.region)
      expect(first.city).toBe(second.city)
    })
  })

  describe('error handling', () => {
    it('should handle detection errors gracefully', async () => {
      // Create storage that will fail on detection-related operations
      const errorStorage = createMockStorage()
      const originalGet = errorStorage.get.bind(errorStorage)
      let callCount = 0
      errorStorage.get = async <T>(key: string): Promise<T | undefined> => {
        callCount++
        // First call checks cache (returns undefined to trigger detection)
        // We're simulating that cache check succeeds but detection fails
        if (callCount === 1) {
          return undefined
        }
        throw new Error('Storage read failed during detection')
      }

      // Should throw or handle detection error appropriately
      await expect(getOrDetectLocation(errorStorage)).rejects.toThrow()
    })

    it('should not cache location if detection fails', async () => {
      const errorStorage = createMockStorage()
      const originalGet = errorStorage.get.bind(errorStorage)
      errorStorage.get = async <T>(_key: string): Promise<T | undefined> => {
        throw new Error('Detection failed')
      }

      try {
        await getOrDetectLocation(errorStorage)
      } catch {
        // Expected to fail
      }

      // Storage should remain empty
      expect(errorStorage._getRawData().size).toBe(0)
    })
  })
})

// ============================================================================
// DOLocation Type Tests
// ============================================================================

describe('DOLocation Type', () => {
  it('should have colo field (ColoCode)', () => {
    const location: DOLocation = {
      ...sampleLocation,
      colo: 'sjc',
    }
    expect(location.colo).toBe('sjc')
  })

  it('should have region field (Region)', () => {
    const location: DOLocation = {
      ...sampleLocation,
      region: 'eu-west',
    }
    expect(location.region).toBe('eu-west')
  })

  it('should have city field (ColoCity)', () => {
    const location: DOLocation = {
      ...sampleLocation,
      city: 'London',
    }
    expect(location.city).toBe('London')
  })

  it('should have cfHint field (CFLocationHint)', () => {
    const location: DOLocation = {
      ...sampleLocation,
      cfHint: 'weur',
    }
    expect(location.cfHint).toBe('weur')
  })

  it('should have detectedAt field (Date)', () => {
    const now = new Date()
    const location: DOLocation = {
      ...sampleLocation,
      detectedAt: now,
    }
    expect(location.detectedAt).toBe(now)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('LocationCache Integration', () => {
  let storage: MockDurableObjectStorage & DurableObjectStorage

  beforeEach(() => {
    storage = createMockStorage()
  })

  it('should work with getOrDetectLocation after manual cache set', async () => {
    const cache = new LocationCache(storage)
    await cache.set(sampleLocation)

    const result = await getOrDetectLocation(storage)

    expect(result.colo).toBe('lax')
    expect(result.city).toBe('LosAngeles')
  })

  it('should work with LocationCache after getOrDetectLocation', async () => {
    await getOrDetectLocation(storage)

    const cache = new LocationCache(storage)
    const hasLocation = await cache.has()

    expect(hasLocation).toBe(true)
  })

  it('should use consistent storage key across cache and function', async () => {
    // Set via cache
    const cache = new LocationCache(storage)
    await cache.set(sampleLocation)

    // Read via getOrDetectLocation
    const result = await getOrDetectLocation(storage)

    expect(result.colo).toBe(sampleLocation.colo)
  })

  it('should clear cache and trigger re-detection', async () => {
    // Initial detection and cache
    await getOrDetectLocation(storage)

    // Clear cache
    const cache = new LocationCache(storage)
    await cache.clear()

    // Should trigger new detection
    const initialPutCount = storage._putCallCount()
    await getOrDetectLocation(storage)

    // Should have written new detection result
    expect(storage._putCallCount()).toBeGreaterThan(initialPutCount)
  })
})
