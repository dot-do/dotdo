/**
 * External Data Client Tests (RED Phase)
 *
 * Issue: dotdo-2bik1 - WHERE-DOs-Live external data client
 *
 * Tests for fetching colo metadata from the WHERE-DOs-Live API until
 * we have enough of our own data. The API provides colo metadata including
 * coordinates and DO support likelihood.
 *
 * TDD RED Phase: These tests should FAIL initially with NOT IMPLEMENTED errors
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest'

// ============================================================================
// Import modules under test (will fail until implemented)
// ============================================================================

import {
  ColoDataClient,
  syncColoData,
  getColoWithLikelihood,
  type ColoMetadata,
  type SyncResult,
} from '../external-data'

import type { ColoCode, Region } from '../../../types/Location'

// ============================================================================
// Mock DurableObjectStorage
// ============================================================================

/**
 * Mock DurableObjectStorage for testing sync operations
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

  _size(): number {
    return this.data.size
  }
}

/**
 * Create a mock storage instance typed as DurableObjectStorage
 */
function createMockStorage(): MockDurableObjectStorage & DurableObjectStorage {
  return new MockDurableObjectStorage() as MockDurableObjectStorage & DurableObjectStorage
}

// ============================================================================
// Test Fixtures
// ============================================================================

const MOCK_API_BASE_URL = 'https://where-dos-live.do.workers.dev/api'

const sampleColoMetadata: ColoMetadata[] = [
  {
    code: 'sjc',
    city: 'SanJose',
    region: 'us-west',
    coordinates: { lat: 37.3639, lng: -121.9289 },
    supportsDOs: true,
    likelihood: 0.95,
    latency: 12,
  },
  {
    code: 'lax',
    city: 'LosAngeles',
    region: 'us-west',
    coordinates: { lat: 33.9425, lng: -118.4081 },
    supportsDOs: true,
    likelihood: 0.92,
    latency: 15,
  },
  {
    code: 'iad',
    city: 'Virginia',
    region: 'us-east',
    coordinates: { lat: 38.9519, lng: -77.4480 },
    supportsDOs: true,
    likelihood: 0.98,
    latency: 8,
  },
  {
    code: 'lhr',
    city: 'London',
    region: 'eu-west',
    coordinates: { lat: 51.4700, lng: -0.4543 },
    supportsDOs: true,
    likelihood: 0.88,
    latency: 25,
  },
  {
    code: 'sin',
    city: 'Singapore',
    region: 'asia-pacific',
    coordinates: { lat: 1.3644, lng: 103.9915 },
    supportsDOs: false,
    likelihood: 0.45,
    latency: 80,
  },
]

const sampleColoWithoutDO: ColoMetadata = {
  code: 'prg',
  city: 'Prague',
  region: 'eu-east',
  coordinates: { lat: 50.1018, lng: 14.2632 },
  supportsDOs: false,
  likelihood: 0.3,
}

/**
 * Create a mock fetch that returns sample colo data
 */
function createMockFetch(responseData: unknown, options: { ok?: boolean; status?: number; delay?: number } = {}) {
  const { ok = true, status = 200, delay = 0 } = options
  return vi.fn(async () => {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    return {
      ok,
      status,
      json: () => Promise.resolve(responseData),
      text: () => Promise.resolve(JSON.stringify(responseData)),
    }
  })
}

// ============================================================================
// ColoMetadata Interface Tests
// ============================================================================

describe('ColoMetadata Interface', () => {
  it('should have code field (ColoCode)', () => {
    const metadata: ColoMetadata = {
      code: 'sjc',
      city: 'SanJose',
      region: 'us-west',
      coordinates: { lat: 37.3639, lng: -121.9289 },
      supportsDOs: true,
    }
    expect(metadata.code).toBe('sjc')
  })

  it('should have city field (ColoCity)', () => {
    const metadata: ColoMetadata = {
      code: 'lax',
      city: 'LosAngeles',
      region: 'us-west',
      coordinates: { lat: 33.9425, lng: -118.4081 },
      supportsDOs: true,
    }
    expect(metadata.city).toBe('LosAngeles')
  })

  it('should have region field (Region)', () => {
    const metadata: ColoMetadata = {
      code: 'lhr',
      city: 'London',
      region: 'eu-west',
      coordinates: { lat: 51.4700, lng: -0.4543 },
      supportsDOs: true,
    }
    expect(metadata.region).toBe('eu-west')
  })

  it('should have coordinates with lat and lng', () => {
    const metadata: ColoMetadata = {
      code: 'nrt',
      city: 'Tokyo',
      region: 'asia-pacific',
      coordinates: { lat: 35.7649, lng: 140.3867 },
      supportsDOs: true,
    }
    expect(metadata.coordinates.lat).toBe(35.7649)
    expect(metadata.coordinates.lng).toBe(140.3867)
  })

  it('should have supportsDOs boolean field', () => {
    const metadata: ColoMetadata = {
      code: 'sin',
      city: 'Singapore',
      region: 'asia-pacific',
      coordinates: { lat: 1.3644, lng: 103.9915 },
      supportsDOs: false,
    }
    expect(metadata.supportsDOs).toBe(false)
  })

  it('should have optional likelihood field (0-1)', () => {
    const metadata: ColoMetadata = {
      code: 'fra',
      city: 'Frankfurt',
      region: 'eu-west',
      coordinates: { lat: 50.0379, lng: 8.5622 },
      supportsDOs: true,
      likelihood: 0.87,
    }
    expect(metadata.likelihood).toBe(0.87)
    expect(metadata.likelihood).toBeGreaterThanOrEqual(0)
    expect(metadata.likelihood).toBeLessThanOrEqual(1)
  })

  it('should have optional latency field', () => {
    const metadata: ColoMetadata = {
      code: 'cdg',
      city: 'Paris',
      region: 'eu-west',
      coordinates: { lat: 49.0097, lng: 2.5479 },
      supportsDOs: true,
      latency: 18,
    }
    expect(metadata.latency).toBe(18)
  })

  it('should allow omitting optional fields', () => {
    const metadata: ColoMetadata = {
      code: 'ams',
      city: 'Amsterdam',
      region: 'eu-west',
      coordinates: { lat: 52.3105, lng: 4.7683 },
      supportsDOs: true,
    }
    expect(metadata.likelihood).toBeUndefined()
    expect(metadata.latency).toBeUndefined()
  })
})

// ============================================================================
// ColoDataClient Class Tests
// ============================================================================

describe('ColoDataClient', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch(sampleColoMetadata)
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create client with default base URL', () => {
      const client = new ColoDataClient()
      expect(client).toBeInstanceOf(ColoDataClient)
    })

    it('should create client with custom base URL', () => {
      const client = new ColoDataClient('https://custom-api.example.com')
      expect(client).toBeInstanceOf(ColoDataClient)
    })
  })

  describe('fetchAllColos()', () => {
    it('should fetch all colos from API', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.fetchAllColos()

      expect(mockFetch).toHaveBeenCalled()
      expect(result).toBeInstanceOf(Array)
      expect(result.length).toBe(sampleColoMetadata.length)
    })

    it('should return ColoMetadata array', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.fetchAllColos()

      expect(result[0]).toHaveProperty('code')
      expect(result[0]).toHaveProperty('city')
      expect(result[0]).toHaveProperty('region')
      expect(result[0]).toHaveProperty('coordinates')
      expect(result[0]).toHaveProperty('supportsDOs')
    })

    it('should fetch from /colos endpoint', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      await client.fetchAllColos()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/colos'),
        expect.anything()
      )
    })

    it('should handle API errors gracefully', async () => {
      globalThis.fetch = createMockFetch({ error: 'Server error' }, { ok: false, status: 500 })
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      await expect(client.fetchAllColos()).rejects.toThrow()
    })

    it('should handle network errors gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      await expect(client.fetchAllColos()).rejects.toThrow('Network error')
    })
  })

  describe('getColo()', () => {
    it('should fetch metadata for specific colo', async () => {
      globalThis.fetch = createMockFetch(sampleColoMetadata[0])
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getColo('sjc')

      expect(result).not.toBeNull()
      expect(result?.code).toBe('sjc')
    })

    it('should return null for unknown colo', async () => {
      globalThis.fetch = createMockFetch(null, { ok: true, status: 404 })
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getColo('xyz' as ColoCode)

      expect(result).toBeNull()
    })

    it('should fetch from /colos/:code endpoint', async () => {
      mockFetch = createMockFetch(sampleColoMetadata[0])
      globalThis.fetch = mockFetch
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      await client.getColo('lax')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/colos/lax'),
        expect.anything()
      )
    })

    it('should return ColoMetadata with all fields', async () => {
      globalThis.fetch = createMockFetch(sampleColoMetadata[2])
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getColo('iad')

      expect(result?.code).toBe('iad')
      expect(result?.city).toBe('Virginia')
      expect(result?.region).toBe('us-east')
      expect(result?.coordinates).toEqual({ lat: 38.9519, lng: -77.4480 })
      expect(result?.supportsDOs).toBe(true)
      expect(result?.likelihood).toBe(0.98)
    })
  })

  describe('getDOColos()', () => {
    it('should return only colos that support DOs', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getDOColos()

      expect(result.every(colo => colo.supportsDOs)).toBe(true)
    })

    it('should filter out non-DO colos', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getDOColos()

      // sampleColoMetadata has 4 DO colos and 1 non-DO (sin)
      expect(result.length).toBe(4)
      expect(result.find(c => c.code === 'sin')).toBeUndefined()
    })

    it('should return empty array if no colos support DOs', async () => {
      globalThis.fetch = createMockFetch([sampleColoWithoutDO])
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getDOColos()

      expect(result).toEqual([])
    })
  })

  describe('getColosByRegion()', () => {
    it('should filter colos by region', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getColosByRegion('us-west')

      expect(result.every(colo => colo.region === 'us-west')).toBe(true)
      expect(result.length).toBe(2) // sjc and lax
    })

    it('should return empty array for region with no colos', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getColosByRegion('south-america')

      expect(result).toEqual([])
    })

    it('should return colos from eu-west region', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getColosByRegion('eu-west')

      expect(result.length).toBe(1) // lhr
      expect(result[0].code).toBe('lhr')
    })

    it('should return colos from asia-pacific region', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await client.getColosByRegion('asia-pacific')

      expect(result.length).toBe(1) // sin
      expect(result[0].code).toBe('sin')
    })
  })

  describe('caching', () => {
    it('should cache results for configurable TTL', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      // First call - should fetch
      await client.fetchAllColos()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Second call - should use cache
      await client.fetchAllColos()
      expect(mockFetch).toHaveBeenCalledTimes(1) // Still 1, used cache
    })

    it('should refetch after TTL expires', async () => {
      vi.useFakeTimers()
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      // First call
      await client.fetchAllColos()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time past TTL (default 5 minutes)
      vi.advanceTimersByTime(6 * 60 * 1000)

      // Should refetch
      await client.fetchAllColos()
      expect(mockFetch).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('should allow custom TTL configuration', async () => {
      vi.useFakeTimers()
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      // Configure short TTL
      client.setCacheTTL(1000) // 1 second

      await client.fetchAllColos()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time past custom TTL
      vi.advanceTimersByTime(1500)

      await client.fetchAllColos()
      expect(mockFetch).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('should allow disabling cache', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)
      client.setCacheTTL(0) // Disable cache

      await client.fetchAllColos()
      await client.fetchAllColos()

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should clear cache when requested', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      await client.fetchAllColos()
      expect(mockFetch).toHaveBeenCalledTimes(1)

      client.clearCache()

      await client.fetchAllColos()
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
})

// ============================================================================
// SyncResult Interface Tests
// ============================================================================

describe('SyncResult Interface', () => {
  it('should have added count', () => {
    const result: SyncResult = {
      added: 5,
      updated: 0,
      removed: 0,
      total: 5,
      syncedAt: new Date(),
    }
    expect(result.added).toBe(5)
  })

  it('should have updated count', () => {
    const result: SyncResult = {
      added: 0,
      updated: 3,
      removed: 0,
      total: 10,
      syncedAt: new Date(),
    }
    expect(result.updated).toBe(3)
  })

  it('should have removed count', () => {
    const result: SyncResult = {
      added: 0,
      updated: 0,
      removed: 2,
      total: 8,
      syncedAt: new Date(),
    }
    expect(result.removed).toBe(2)
  })

  it('should have total count', () => {
    const result: SyncResult = {
      added: 2,
      updated: 1,
      removed: 1,
      total: 10,
      syncedAt: new Date(),
    }
    expect(result.total).toBe(10)
  })

  it('should have syncedAt timestamp', () => {
    const now = new Date()
    const result: SyncResult = {
      added: 0,
      updated: 0,
      removed: 0,
      total: 5,
      syncedAt: now,
    }
    expect(result.syncedAt).toBeInstanceOf(Date)
    expect(result.syncedAt).toBe(now)
  })
})

// ============================================================================
// syncColoData() Function Tests
// ============================================================================

describe('syncColoData()', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch
  let storage: MockDurableObjectStorage & DurableObjectStorage

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch(sampleColoMetadata)
    globalThis.fetch = mockFetch
    storage = createMockStorage()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('initial sync', () => {
    it('should sync all colo data to storage', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await syncColoData(client, storage)

      expect(result.total).toBe(sampleColoMetadata.length)
      expect(storage._size()).toBeGreaterThan(0)
    })

    it('should store each colo with proper key', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      await syncColoData(client, storage)

      const data = storage._getRawData()
      // Check that colos are stored with a consistent key format
      expect(data.has('colo:sjc') || data.has('colos:sjc') || data.has('external:colo:sjc')).toBe(true)
    })

    it('should return SyncResult with added count', async () => {
      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await syncColoData(client, storage)

      expect(result.added).toBe(sampleColoMetadata.length)
      expect(result.updated).toBe(0)
      expect(result.removed).toBe(0)
    })

    it('should include syncedAt timestamp', async () => {
      vi.useFakeTimers()
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)

      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await syncColoData(client, storage)

      expect(result.syncedAt).toBeInstanceOf(Date)
      expect(result.syncedAt.getTime()).toBe(now.getTime())

      vi.useRealTimers()
    })
  })

  describe('update sync', () => {
    it('should update existing data', async () => {
      // Pre-populate with old data
      storage._setRawData('colo:sjc', { ...sampleColoMetadata[0], likelihood: 0.5 })

      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await syncColoData(client, storage)

      expect(result.updated).toBeGreaterThanOrEqual(1)
    })

    it('should track sync statistics correctly', async () => {
      // Pre-populate with some existing data
      storage._setRawData('colo:sjc', sampleColoMetadata[0])
      storage._setRawData('colo:lax', sampleColoMetadata[1])

      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await syncColoData(client, storage)

      // Should have: existing 2 (may be updated), new ones added
      expect(result.total).toBe(sampleColoMetadata.length)
    })

    it('should remove colos no longer in API response', async () => {
      // Pre-populate with a colo that won't be in API response
      storage._setRawData('colo:xyz', { code: 'xyz', city: 'Unknown', region: 'us-west', coordinates: { lat: 0, lng: 0 }, supportsDOs: false })

      const client = new ColoDataClient(MOCK_API_BASE_URL)

      const result = await syncColoData(client, storage)

      expect(result.removed).toBeGreaterThanOrEqual(1)
    })
  })

  describe('error handling', () => {
    it('should handle partial failures gracefully', async () => {
      // Mock storage that fails on some puts
      let putCount = 0
      const failingStorage = createMockStorage()
      const originalPut = failingStorage.put.bind(failingStorage)
      failingStorage.put = async (key: string, value: unknown) => {
        putCount++
        if (putCount === 3) {
          throw new Error('Storage write failed')
        }
        return originalPut(key, value)
      }

      const client = new ColoDataClient(MOCK_API_BASE_URL)

      // Should not throw, but handle gracefully
      const result = await syncColoData(client, failingStorage)

      // Should still return a result, possibly with partial success
      expect(result).toBeDefined()
      expect(result.total).toBeLessThanOrEqual(sampleColoMetadata.length)
    })

    it('should throw on complete API failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('API unavailable'))

      const client = new ColoDataClient(MOCK_API_BASE_URL)

      await expect(syncColoData(client, storage)).rejects.toThrow()
    })

    it('should return empty result on API error with fallback', async () => {
      globalThis.fetch = createMockFetch({ error: 'Server error' }, { ok: false, status: 500 })

      const client = new ColoDataClient(MOCK_API_BASE_URL)

      // Depending on implementation, might throw or return empty
      try {
        const result = await syncColoData(client, storage)
        expect(result.total).toBe(0)
      } catch {
        // Also acceptable behavior
        expect(true).toBe(true)
      }
    })
  })
})

// ============================================================================
// getColoWithLikelihood() Function Tests
// ============================================================================

describe('getColoWithLikelihood()', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch(sampleColoMetadata[0])
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should return colo metadata with likelihood', async () => {
    const client = new ColoDataClient(MOCK_API_BASE_URL)

    const result = await getColoWithLikelihood('sjc', client)

    expect(result.code).toBe('sjc')
    expect(result.likelihood).toBeDefined()
    expect(typeof result.likelihood).toBe('number')
  })

  it('should always include likelihood in result', async () => {
    // Even if API returns colo without likelihood, we should provide a default
    globalThis.fetch = createMockFetch({
      code: 'lax',
      city: 'LosAngeles',
      region: 'us-west',
      coordinates: { lat: 33.9425, lng: -118.4081 },
      supportsDOs: true,
      // No likelihood field
    })

    const client = new ColoDataClient(MOCK_API_BASE_URL)

    const result = await getColoWithLikelihood('lax', client)

    expect(result.likelihood).toBeDefined()
    expect(typeof result.likelihood).toBe('number')
    expect(result.likelihood).toBeGreaterThanOrEqual(0)
    expect(result.likelihood).toBeLessThanOrEqual(1)
  })

  it('should return likelihood between 0 and 1', async () => {
    const client = new ColoDataClient(MOCK_API_BASE_URL)

    const result = await getColoWithLikelihood('sjc', client)

    expect(result.likelihood).toBeGreaterThanOrEqual(0)
    expect(result.likelihood).toBeLessThanOrEqual(1)
  })

  it('should throw for unknown colo', async () => {
    globalThis.fetch = createMockFetch(null, { ok: true, status: 404 })

    const client = new ColoDataClient(MOCK_API_BASE_URL)

    await expect(getColoWithLikelihood('xyz' as ColoCode, client)).rejects.toThrow()
  })

  it('should include all ColoMetadata fields plus likelihood', async () => {
    const client = new ColoDataClient(MOCK_API_BASE_URL)

    const result = await getColoWithLikelihood('sjc', client)

    // Should have all base fields
    expect(result.code).toBe('sjc')
    expect(result.city).toBe('SanJose')
    expect(result.region).toBe('us-west')
    expect(result.coordinates).toEqual({ lat: 37.3639, lng: -121.9289 })
    expect(result.supportsDOs).toBe(true)
    // Plus likelihood (required in return type)
    expect(result.likelihood).toBe(0.95)
  })

  it('should return type with required likelihood', async () => {
    const client = new ColoDataClient(MOCK_API_BASE_URL)

    const result = await getColoWithLikelihood('sjc', client)

    // TypeScript type check - likelihood should be required, not optional
    const likelihood: number = result.likelihood
    expect(likelihood).toBeDefined()
  })
})

// ============================================================================
// Type Export Tests
// ============================================================================

describe('Type Exports', () => {
  it('exports ColoDataClient class', () => {
    expect(typeof ColoDataClient).toBe('function')
  })

  it('exports syncColoData function', () => {
    expect(typeof syncColoData).toBe('function')
  })

  it('exports getColoWithLikelihood function', () => {
    expect(typeof getColoWithLikelihood).toBe('function')
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('External Data Integration', () => {
  let mockFetch: Mock
  let originalFetch: typeof globalThis.fetch
  let storage: MockDurableObjectStorage & DurableObjectStorage

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = createMockFetch(sampleColoMetadata)
    globalThis.fetch = mockFetch
    storage = createMockStorage()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('should sync and then retrieve individual colo', async () => {
    const client = new ColoDataClient(MOCK_API_BASE_URL)

    await syncColoData(client, storage)

    globalThis.fetch = createMockFetch(sampleColoMetadata[0])
    const colo = await client.getColo('sjc')

    expect(colo?.code).toBe('sjc')
  })

  it('should sync and filter by region', async () => {
    const client = new ColoDataClient(MOCK_API_BASE_URL)

    await syncColoData(client, storage)

    const usWestColos = await client.getColosByRegion('us-west')

    expect(usWestColos.length).toBeGreaterThan(0)
    expect(usWestColos.every(c => c.region === 'us-west')).toBe(true)
  })

  it('should sync and get DO-supported colos', async () => {
    const client = new ColoDataClient(MOCK_API_BASE_URL)

    await syncColoData(client, storage)

    const doColos = await client.getDOColos()

    expect(doColos.every(c => c.supportsDOs)).toBe(true)
  })

  it('should handle multiple sync operations', async () => {
    const client = new ColoDataClient(MOCK_API_BASE_URL)

    const result1 = await syncColoData(client, storage)
    const result2 = await syncColoData(client, storage)

    // Second sync should mostly update, not add
    expect(result2.added).toBeLessThanOrEqual(result1.added)
  })
})
