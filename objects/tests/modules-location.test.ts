/**
 * LocationModule Unit Tests
 *
 * Tests for the extracted LocationModule from DOBase.
 * Verifies:
 * - Location detection via CF trace endpoint
 * - In-memory caching behavior
 * - Persistent storage caching
 * - Coordinate extraction from request headers
 * - Lifecycle hook invocation (onLocationDetected)
 * - Cache clearing and refresh
 *
 * Part of Phase 1 DOBase decomposition (low-risk extractions).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  LocationModule,
  type LocationStorage,
  type LocationDetectedHook,
} from '../modules/LocationModule'
import type { DOLocation } from '../../types/Location'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Create mock storage that simulates DO storage
 */
function createMockStorage(): LocationStorage & { _storage: Map<string, unknown> } {
  const storage = new Map<string, unknown>()

  return {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async (key: string, value: unknown): Promise<void> => {
      storage.set(key, value)
    }),
    _storage: storage,
  }
}

/**
 * Create mock request with CF location headers
 */
function createMockRequest(options?: {
  latitude?: string
  longitude?: string
}): Request {
  const headers = new Headers()
  if (options?.latitude) {
    headers.set('cf-iplatitude', options.latitude)
  }
  if (options?.longitude) {
    headers.set('cf-iplongitude', options.longitude)
  }
  return new Request('https://test.example.com/health', { headers })
}

// ============================================================================
// TEST SUITE: LocationModule Core Functionality
// ============================================================================

describe('LocationModule', () => {
  let mockStorage: ReturnType<typeof createMockStorage>
  let locationModule: LocationModule

  beforeEach(() => {
    mockStorage = createMockStorage()
    locationModule = new LocationModule(mockStorage)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // CONSTRUCTOR AND INITIALIZATION TESTS
  // ==========================================================================

  describe('constructor', () => {
    it('should create instance with storage', () => {
      const module = new LocationModule(mockStorage)
      expect(module).toBeDefined()
    })

    it('should create instance with optional lifecycle hook', () => {
      const hook: LocationDetectedHook = vi.fn()
      const module = new LocationModule(mockStorage, hook)
      expect(module).toBeDefined()
    })

    it('should start with no cached location', () => {
      const module = new LocationModule(mockStorage)
      expect(module.hasCachedLocation).toBe(false)
    })

    it('should start with no extracted coordinates', () => {
      const module = new LocationModule(mockStorage)
      expect(module.extractedCoordinates).toBeUndefined()
    })
  })

  // ==========================================================================
  // LOCATION DETECTION TESTS
  // ==========================================================================

  describe('_detectLocation', () => {
    it('should detect location and return DOLocation object', async () => {
      // Mock the fetch for CF trace endpoint
      const mockResponse = `fl=123\nvisit_scheme=https\ncolo=LAX\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockResponse, { status: 200 })
      )

      const location = await locationModule._detectLocation()

      expect(location).toHaveProperty('colo')
      expect(location).toHaveProperty('city')
      expect(location).toHaveProperty('region')
      expect(location).toHaveProperty('cfHint')
      expect(location).toHaveProperty('detectedAt')
      expect(location.detectedAt).toBeInstanceOf(Date)
    })

    it('should parse colo code from trace response', async () => {
      const mockResponse = `fl=123\ncolo=IAD\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockResponse, { status: 200 })
      )

      const location = await locationModule._detectLocation()

      expect(location.colo).toBe('iad')
    })

    it('should fallback to LAX when trace endpoint fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'))

      const location = await locationModule._detectLocation()

      expect(location.colo).toBe('lax')
      expect(location.city).toBe('LosAngeles')
      expect(location.region).toBe('us-west')
    })

    it('should fallback when trace endpoint returns error status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Server Error', { status: 500 })
      )

      const location = await locationModule._detectLocation()

      expect(location.colo).toBe('lax')
    })

    it('should include extracted coordinates if available', async () => {
      const mockResponse = `fl=123\ncolo=SFO\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockResponse, { status: 200 })
      )

      // Extract coordinates from a request first
      const request = createMockRequest({
        latitude: '37.7749',
        longitude: '-122.4194',
      })
      locationModule.extractCoordinatesFromRequest(request)

      const location = await locationModule._detectLocation()

      expect(location.coordinates).toBeDefined()
      expect(location.coordinates?.lat).toBeCloseTo(37.7749, 4)
      expect(location.coordinates?.lng).toBeCloseTo(-122.4194, 4)
    })
  })

  // ==========================================================================
  // COORDINATE EXTRACTION TESTS
  // ==========================================================================

  describe('extractCoordinatesFromRequest', () => {
    it('should extract coordinates from CF headers', () => {
      const request = createMockRequest({
        latitude: '34.0522',
        longitude: '-118.2437',
      })

      locationModule.extractCoordinatesFromRequest(request)

      expect(locationModule.extractedCoordinates).toBeDefined()
      expect(locationModule.extractedCoordinates?.lat).toBeCloseTo(34.0522, 4)
      expect(locationModule.extractedCoordinates?.lng).toBeCloseTo(-118.2437, 4)
    })

    it('should not extract coordinates when headers are missing', () => {
      const request = createMockRequest({})

      locationModule.extractCoordinatesFromRequest(request)

      expect(locationModule.extractedCoordinates).toBeUndefined()
    })

    it('should not extract coordinates when only latitude is present', () => {
      const request = createMockRequest({ latitude: '34.0522' })

      locationModule.extractCoordinatesFromRequest(request)

      expect(locationModule.extractedCoordinates).toBeUndefined()
    })

    it('should not extract coordinates when only longitude is present', () => {
      const request = createMockRequest({ longitude: '-118.2437' })

      locationModule.extractCoordinatesFromRequest(request)

      expect(locationModule.extractedCoordinates).toBeUndefined()
    })

    it('should handle invalid latitude/longitude values', () => {
      const headers = new Headers()
      headers.set('cf-iplatitude', 'invalid')
      headers.set('cf-iplongitude', 'not-a-number')
      const request = new Request('https://test.example.com', { headers })

      locationModule.extractCoordinatesFromRequest(request)

      expect(locationModule.extractedCoordinates).toBeUndefined()
    })

    it('should overwrite previously extracted coordinates', () => {
      const request1 = createMockRequest({
        latitude: '34.0522',
        longitude: '-118.2437',
      })
      const request2 = createMockRequest({
        latitude: '40.7128',
        longitude: '-74.0060',
      })

      locationModule.extractCoordinatesFromRequest(request1)
      expect(locationModule.extractedCoordinates?.lat).toBeCloseTo(34.0522, 4)

      locationModule.extractCoordinatesFromRequest(request2)
      expect(locationModule.extractedCoordinates?.lat).toBeCloseTo(40.7128, 4)
    })
  })

  // ==========================================================================
  // CACHING TESTS
  // ==========================================================================

  describe('getLocation caching', () => {
    beforeEach(() => {
      const mockResponse = `fl=123\ncolo=SFO\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(mockResponse, { status: 200 })
      )
    })

    it('should cache location after first detection', async () => {
      expect(locationModule.hasCachedLocation).toBe(false)

      await locationModule.getLocation()

      expect(locationModule.hasCachedLocation).toBe(true)
    })

    it('should return same cached instance on subsequent calls', async () => {
      const location1 = await locationModule.getLocation()
      const location2 = await locationModule.getLocation()
      const location3 = await locationModule.getLocation()

      // Should be the exact same object reference (cached)
      expect(location1).toBe(location2)
      expect(location2).toBe(location3)
    })

    it('should only detect location once (not re-detect)', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      await locationModule.getLocation()
      await locationModule.getLocation()
      await locationModule.getLocation()

      // fetch should only be called once for initial detection
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('should return frozen/immutable location object', async () => {
      const location = await locationModule.getLocation()

      expect(Object.isFrozen(location)).toBe(true)
    })
  })

  // ==========================================================================
  // PERSISTENT STORAGE TESTS
  // ==========================================================================

  describe('persistent storage', () => {
    it('should persist detected location to storage', async () => {
      const mockResponse = `fl=123\ncolo=DFW\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockResponse, { status: 200 })
      )

      await locationModule.getLocation()

      expect(mockStorage.put).toHaveBeenCalledWith(
        'do:location',
        expect.objectContaining({
          colo: expect.any(String),
          city: expect.any(String),
          region: expect.any(String),
          cfHint: expect.any(String),
          detectedAt: expect.any(String),
        })
      )
    })

    it('should restore location from storage if available', async () => {
      // Spy on fetch before caching so we can verify it's not called
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const cachedLocation = {
        colo: 'jfk',
        city: 'NewYork',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: '2024-01-15T12:00:00.000Z',
      }
      mockStorage._storage.set('do:location', cachedLocation)

      const location = await locationModule.getLocation()

      expect(location.colo).toBe('jfk')
      expect(location.city).toBe('NewYork')
      expect(location.region).toBe('us-east')
      // Should not call fetch since restored from storage
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should restore coordinates from storage (new format)', async () => {
      const cachedLocation = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        detectedAt: '2024-01-15T12:00:00.000Z',
        coordinates: {
          lat: 34.0522,
          lng: -118.2437,
        },
      }
      mockStorage._storage.set('do:location', cachedLocation)

      const location = await locationModule.getLocation()

      expect(location.coordinates).toBeDefined()
      expect(location.coordinates?.lat).toBeCloseTo(34.0522, 4)
      expect(location.coordinates?.lng).toBeCloseTo(-118.2437, 4)
    })

    it('should restore coordinates from storage (legacy format)', async () => {
      const cachedLocation = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        detectedAt: '2024-01-15T12:00:00.000Z',
        coordinates: {
          latitude: 34.0522,
          longitude: -118.2437,
        },
      }
      mockStorage._storage.set('do:location', cachedLocation)

      const location = await locationModule.getLocation()

      expect(location.coordinates).toBeDefined()
      expect(location.coordinates?.lat).toBeCloseTo(34.0522, 4)
      expect(location.coordinates?.lng).toBeCloseTo(-118.2437, 4)
    })

    it('should convert detectedAt string to Date', async () => {
      const cachedLocation = {
        colo: 'ord',
        city: 'Chicago',
        region: 'us-central',
        cfHint: 'cnam',
        detectedAt: '2024-06-01T08:30:00.000Z',
      }
      mockStorage._storage.set('do:location', cachedLocation)

      const location = await locationModule.getLocation()

      expect(location.detectedAt).toBeInstanceOf(Date)
      expect(location.detectedAt.toISOString()).toBe('2024-06-01T08:30:00.000Z')
    })

    it('should handle Date object in storage (already Date)', async () => {
      const cachedLocation = {
        colo: 'ord',
        city: 'Chicago',
        region: 'us-central',
        cfHint: 'cnam',
        detectedAt: new Date('2024-06-01T08:30:00.000Z'),
      }
      mockStorage._storage.set('do:location', cachedLocation)

      const location = await locationModule.getLocation()

      expect(location.detectedAt).toBeInstanceOf(Date)
    })
  })

  // ==========================================================================
  // LIFECYCLE HOOK TESTS
  // ==========================================================================

  describe('onLocationDetected lifecycle hook', () => {
    it('should call hook when location first detected', async () => {
      const mockResponse = `fl=123\ncolo=SEA\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockResponse, { status: 200 })
      )

      const hook = vi.fn()
      const module = new LocationModule(mockStorage, hook)

      await module.getLocation()

      expect(hook).toHaveBeenCalledTimes(1)
      expect(hook).toHaveBeenCalledWith(expect.objectContaining({
        colo: expect.any(String),
        city: expect.any(String),
        region: expect.any(String),
      }))
    })

    it('should not call hook on subsequent getLocation calls', async () => {
      const mockResponse = `fl=123\ncolo=SEA\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(mockResponse, { status: 200 })
      )

      const hook = vi.fn()
      const module = new LocationModule(mockStorage, hook)

      await module.getLocation()
      await module.getLocation()
      await module.getLocation()

      expect(hook).toHaveBeenCalledTimes(1)
    })

    it('should not call hook when restored from storage', async () => {
      const cachedLocation = {
        colo: 'atl',
        city: 'Atlanta',
        region: 'us-south',
        cfHint: 'snam',
        detectedAt: '2024-01-15T12:00:00.000Z',
      }
      mockStorage._storage.set('do:location', cachedLocation)

      const hook = vi.fn()
      const module = new LocationModule(mockStorage, hook)

      await module.getLocation()

      // Hook should NOT be called for restored location
      expect(hook).not.toHaveBeenCalled()
    })

    it('should not propagate hook errors', async () => {
      const mockResponse = `fl=123\ncolo=SEA\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockResponse, { status: 200 })
      )

      const hook = vi.fn().mockRejectedValue(new Error('Hook error'))
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const module = new LocationModule(mockStorage, hook)

      // Should not throw
      const location = await module.getLocation()

      expect(location).toBeDefined()
      expect(location.colo).toBeDefined()
      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should allow setting hook after construction', async () => {
      const mockResponse = `fl=123\ncolo=DEN\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(mockResponse, { status: 200 })
      )

      const hook = vi.fn()
      const module = new LocationModule(mockStorage)
      module.setOnLocationDetected(hook)

      await module.getLocation()

      expect(hook).toHaveBeenCalledTimes(1)
    })
  })

  // ==========================================================================
  // CACHE CLEARING TESTS
  // ==========================================================================

  describe('clearCache', () => {
    it('should clear cached location', async () => {
      const mockResponse = `fl=123\ncolo=PHX\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(mockResponse, { status: 200 })
      )

      await locationModule.getLocation()
      expect(locationModule.hasCachedLocation).toBe(true)

      locationModule.clearCache()

      expect(locationModule.hasCachedLocation).toBe(false)
    })

    it('should clear extracted coordinates', async () => {
      const request = createMockRequest({
        latitude: '34.0522',
        longitude: '-118.2437',
      })
      locationModule.extractCoordinatesFromRequest(request)
      expect(locationModule.extractedCoordinates).toBeDefined()

      locationModule.clearCache()

      expect(locationModule.extractedCoordinates).toBeUndefined()
    })

    it('should reset hook called flag (allow hook to be called again)', async () => {
      const mockResponse = `fl=123\ncolo=PDX\nloc=US\n`
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(mockResponse, { status: 200 })
      )

      const hook = vi.fn()
      const module = new LocationModule(mockStorage, hook)

      await module.getLocation()
      expect(hook).toHaveBeenCalledTimes(1)

      module.clearCache()
      // Also clear storage to force re-detection
      mockStorage._storage.clear()

      await module.getLocation()
      expect(hook).toHaveBeenCalledTimes(2)
    })

    it('should allow fresh detection after clearing', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      fetchSpy.mockResolvedValue(
        new Response(`fl=123\ncolo=SLC\nloc=US\n`, { status: 200 })
      )

      const location1 = await locationModule.getLocation()
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      locationModule.clearCache()
      // Clear storage too
      mockStorage._storage.clear()

      fetchSpy.mockResolvedValueOnce(
        new Response(`fl=123\ncolo=MSP\nloc=US\n`, { status: 200 })
      )

      const location2 = await locationModule.getLocation()

      // Should have called fetch again after cache clear
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      // Different location objects
      expect(location1).not.toBe(location2)
    })
  })

  // ==========================================================================
  // EDGE CASES AND ERROR HANDLING
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty trace response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('', { status: 200 })
      )

      const location = await locationModule.getLocation()

      // Should fallback to defaults
      expect(location.colo).toBe('lax')
    })

    it('should handle trace response with only newlines', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('\n\n\n', { status: 200 })
      )

      const location = await locationModule.getLocation()

      expect(location.colo).toBe('lax')
    })

    it('should handle trace response with malformed lines', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('malformed\nno-equals-sign\ncolo=ORD', { status: 200 })
      )

      const location = await locationModule.getLocation()

      expect(location.colo).toBe('ord')
    })

    it('should handle network timeout', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Timeout'))

      const location = await locationModule.getLocation()

      expect(location.colo).toBe('lax')
      expect(location.region).toBe('us-west')
    })

    it('should handle unknown colo code gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('colo=XYZ', { status: 200 })
      )

      const location = await locationModule.getLocation()

      // Unknown colo should still work (with fallback city mapping)
      expect(location.colo).toBe('xyz')
    })
  })
})
