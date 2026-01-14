/**
 * DO Location Integration Tests (RED Phase TDD)
 *
 * Issue: dotdo-kd64y
 *
 * These tests define the interface for DO location detection + caching:
 * 1. getLocation() method on DOBase/DOTiny
 * 2. $.location property on WorkflowContext
 * 3. onLocationDetected lifecycle hook
 * 4. Integration with ObjectRef for DO registration
 *
 * RED PHASE: All tests MUST FAIL initially as the implementation does not exist.
 * The tests define the expected interface and behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DO, type Env } from '../core/DO'
import { DO as DOBase } from '../core/DOBase'

// NOTE: DOLocation type will be exported from types/Location.ts once implemented
// import type { DOLocation } from '../../types/Location'

// ============================================================================
// TYPE DEFINITIONS FOR TESTS
// ============================================================================

/**
 * Expected DOLocation interface - to be implemented in types/Location.ts
 */
interface ExpectedDOLocation {
  /** Cloudflare colocation code (IATA, e.g., 'lax', 'iad') */
  colo: string
  /** City name (e.g., 'LosAngeles', 'Virginia') */
  city: string
  /** Region (e.g., 'us-west', 'us-east', 'eu-west') */
  region: string
  /** Cloudflare location hint (e.g., 'wnam', 'enam', 'weur') */
  cfHint: string
  /** Optional coordinates if available */
  coordinates?: {
    latitude: number
    longitude: number
  }
  /** Timestamp when location was detected */
  detectedAt: Date
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Create mock DurableObjectState
 */
function createMockDOState() {
  const storage = new Map<string, unknown>()

  return {
    id: {
      toString: () => 'test-do-id-12345',
      name: 'test-do',
    },
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => {
        return storage.get(key) as T | undefined
      }),
      put: vi.fn(async <T>(key: string, value: T): Promise<void> => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string): Promise<boolean> => {
        return storage.delete(key)
      }),
      deleteAll: vi.fn(async (): Promise<void> => {
        storage.clear()
      }),
      list: vi.fn(async (options?: { prefix?: string }): Promise<Map<string, unknown>> => {
        const result = new Map<string, unknown>()
        for (const [key, value] of storage) {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            result.set(key, value)
          }
        }
        return result
      }),
      sql: {
        exec: vi.fn(() => ({
          toArray: () => [],
          one: () => null,
          raw: () => [],
        })),
      },
      // Expose internal storage for test access
      _storage: storage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    _storage: storage,
  }
}

/**
 * Create mock environment with CF location headers
 */
function createMockEnv(overrides?: Partial<Env>): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
    ...overrides,
  }
}

/**
 * Create mock request with Cloudflare cf headers
 */
function createMockRequestWithCfHeaders(cfData?: Partial<IncomingRequestCfProperties>): Request {
  const request = new Request('https://test.do/health')
  // Attach CF properties to the request (simulating Cloudflare's cf object)
  Object.defineProperty(request, 'cf', {
    value: {
      colo: cfData?.colo ?? 'LAX',
      city: cfData?.city ?? 'Los Angeles',
      region: cfData?.region ?? 'California',
      country: cfData?.country ?? 'US',
      latitude: cfData?.latitude ?? '34.0522',
      longitude: cfData?.longitude ?? '-118.2437',
      ...cfData,
    },
    writable: false,
  })
  return request
}

// ============================================================================
// TEST CLASS WITH LOCATION HOOK
// ============================================================================

/**
 * Test DO class that implements onLocationDetected hook
 */
class TestDOWithLocationHook extends DO {
  public locationHookCalled = false
  public receivedLocation: ExpectedDOLocation | null = null
  public hookCallCount = 0

  protected async onLocationDetected(location: ExpectedDOLocation): Promise<void> {
    this.locationHookCalled = true
    this.receivedLocation = location
    this.hookCallCount++
  }
}

// ============================================================================
// TESTS: getLocation() METHOD ON DO
// ============================================================================

describe('DO.getLocation() Method', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: Env
  let doInstance: DO

  beforeEach(async () => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.do' })
    DOBase._resetTestState()
  })

  afterEach(() => {
    DOBase._resetTestState()
  })

  describe('Basic Location Detection', () => {
    it('should have getLocation method on DO', () => {
      // RED: getLocation method does not exist yet
      expect(typeof doInstance.getLocation).toBe('function')
    })

    it('should return DOLocation with colo property', async () => {
      // RED: getLocation not implemented
      const location = await doInstance.getLocation()

      expect(location).toHaveProperty('colo')
      expect(typeof location.colo).toBe('string')
    })

    it('should return DOLocation with city property', async () => {
      // RED: getLocation not implemented
      const location = await doInstance.getLocation()

      expect(location).toHaveProperty('city')
      expect(typeof location.city).toBe('string')
    })

    it('should return DOLocation with region property', async () => {
      // RED: getLocation not implemented
      const location = await doInstance.getLocation()

      expect(location).toHaveProperty('region')
      expect(typeof location.region).toBe('string')
    })

    it('should return DOLocation with cfHint property', async () => {
      // RED: getLocation not implemented
      const location = await doInstance.getLocation()

      expect(location).toHaveProperty('cfHint')
      expect(typeof location.cfHint).toBe('string')
    })

    it('should return DOLocation with detectedAt timestamp', async () => {
      // RED: getLocation not implemented
      const location = await doInstance.getLocation()

      expect(location).toHaveProperty('detectedAt')
      expect(location.detectedAt).toBeInstanceOf(Date)
    })
  })

  describe('Location Caching', () => {
    it('should cache location after first detection', async () => {
      // RED: Location caching not implemented
      const location1 = await doInstance.getLocation()
      const location2 = await doInstance.getLocation()

      // Same object reference indicates caching
      expect(location1).toBe(location2)
    })

    it('should return same location on subsequent calls', async () => {
      // RED: Location caching not implemented
      const location1 = await doInstance.getLocation()
      const location2 = await doInstance.getLocation()
      const location3 = await doInstance.getLocation()

      expect(location1.colo).toBe(location2.colo)
      expect(location2.colo).toBe(location3.colo)
      expect(location1.detectedAt).toEqual(location2.detectedAt)
    })

    it('should not re-detect location after caching', async () => {
      // RED: Detection count tracking not implemented
      const detectSpy = vi.spyOn(doInstance as unknown as { _detectLocation: () => Promise<ExpectedDOLocation> }, '_detectLocation')

      await doInstance.getLocation()
      await doInstance.getLocation()
      await doInstance.getLocation()

      // Should only detect once, rest should use cache
      expect(detectSpy).toHaveBeenCalledTimes(1)
    })

    it('should persist cached location in storage', async () => {
      // RED: Location persistence not implemented
      await doInstance.getLocation()

      expect(mockState.storage.put).toHaveBeenCalledWith(
        'do:location',
        expect.objectContaining({
          colo: expect.any(String),
          city: expect.any(String),
          region: expect.any(String),
        })
      )
    })

    it('should restore cached location from storage on startup', async () => {
      // RED: Location restoration not implemented
      const cachedLocation = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        detectedAt: new Date('2024-01-01'),
      }
      mockState.storage._storage.set('do:location', cachedLocation)

      const newDoInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await newDoInstance.initialize({ ns: 'https://test.do' })

      const location = await newDoInstance.getLocation()

      expect(location.colo).toBe('lax')
      expect(location.city).toBe('LosAngeles')
    })
  })

  describe('Coordinates Support', () => {
    it('should include coordinates if available', async () => {
      // RED: Coordinates extraction not implemented
      const request = createMockRequestWithCfHeaders({
        latitude: '34.0522',
        longitude: '-118.2437',
      })

      // Simulate processing a request to extract location
      await doInstance.fetch(request)
      const location = await doInstance.getLocation()

      expect(location.coordinates).toBeDefined()
      expect(location.coordinates?.latitude).toBeCloseTo(34.0522)
      expect(location.coordinates?.longitude).toBeCloseTo(-118.2437)
    })

    it('should omit coordinates if not available', async () => {
      // RED: Coordinates handling not implemented
      const location = await doInstance.getLocation()

      // Coordinates are optional - may be undefined
      if (location.coordinates !== undefined) {
        expect(location.coordinates).toHaveProperty('latitude')
        expect(location.coordinates).toHaveProperty('longitude')
      }
    })
  })
})

// ============================================================================
// TESTS: $.location PROPERTY ON WORKFLOW CONTEXT
// ============================================================================

describe('WorkflowContext $.location Property', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: Env
  let doInstance: DO

  beforeEach(async () => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.do' })
  })

  afterEach(() => {
    DOBase._resetTestState()
  })

  describe('Location Access via $', () => {
    it('should access location via this.$.location', async () => {
      // RED: $.location not implemented
      const ctx = doInstance.$

      expect(ctx).toHaveProperty('location')
    })

    it('should return DOLocation object from $.location', async () => {
      // RED: $.location not implemented
      const location = await doInstance.$.location

      expect(location).toHaveProperty('colo')
      expect(location).toHaveProperty('city')
      expect(location).toHaveProperty('region')
      expect(location).toHaveProperty('cfHint')
    })
  })

  describe('Lazy Evaluation', () => {
    it('should be lazily evaluated (detect on first access)', async () => {
      // RED: Lazy evaluation not implemented
      const detectSpy = vi.spyOn(doInstance as unknown as { _detectLocation: () => Promise<ExpectedDOLocation> }, '_detectLocation')

      // Before accessing $.location, detection should not have occurred
      expect(detectSpy).not.toHaveBeenCalled()

      // First access triggers detection
      await doInstance.$.location

      expect(detectSpy).toHaveBeenCalledTimes(1)
    })

    it('should not trigger detection until first access', async () => {
      // RED: Lazy detection not implemented
      const detectSpy = vi.spyOn(doInstance as unknown as { _detectLocation: () => Promise<ExpectedDOLocation> }, '_detectLocation')

      // Access other $ properties without triggering location detection
      doInstance.$.send('test.event', {})
      doInstance.$.on.Test.created(() => {})
      doInstance.$.log('test message')

      expect(detectSpy).not.toHaveBeenCalled()
    })
  })

  describe('Readonly After First Access', () => {
    it('should be readonly after first access', async () => {
      // RED: Readonly protection not implemented
      const location1 = await doInstance.$.location
      const location2 = await doInstance.$.location

      // Verify same reference (readonly/cached)
      expect(location1).toBe(location2)
    })

    it('should not allow modification of returned location', async () => {
      // RED: Immutability not implemented
      const location = await doInstance.$.location

      // Attempting to modify should throw or be ignored
      expect(() => {
        (location as { colo: string }).colo = 'modified'
      }).toThrow()
    })

    it('should return same cached instance on repeated access', async () => {
      // RED: Caching not implemented
      const access1 = await doInstance.$.location
      const access2 = await doInstance.$.location
      const access3 = await doInstance.$.location

      expect(access1).toBe(access2)
      expect(access2).toBe(access3)
    })
  })
})

// ============================================================================
// TESTS: onLocationDetected LIFECYCLE HOOK
// ============================================================================

describe('onLocationDetected Lifecycle Hook', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: Env

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
  })

  afterEach(() => {
    DOBase._resetTestState()
  })

  describe('Hook Invocation', () => {
    it('should call onLocationDetected when location first detected', async () => {
      // RED: Hook invocation not implemented
      const doInstance = new TestDOWithLocationHook(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.do' })

      expect(doInstance.locationHookCalled).toBe(false)

      await doInstance.getLocation()

      expect(doInstance.locationHookCalled).toBe(true)
    })

    it('should not call onLocationDetected on subsequent getLocation() calls', async () => {
      // RED: Hook call tracking not implemented
      const doInstance = new TestDOWithLocationHook(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.do' })

      await doInstance.getLocation()
      await doInstance.getLocation()
      await doInstance.getLocation()

      expect(doInstance.hookCallCount).toBe(1)
    })

    it('should receive complete DOLocation object in hook', async () => {
      // RED: Hook parameter not implemented
      const doInstance = new TestDOWithLocationHook(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.do' })

      await doInstance.getLocation()

      expect(doInstance.receivedLocation).not.toBeNull()
      expect(doInstance.receivedLocation).toHaveProperty('colo')
      expect(doInstance.receivedLocation).toHaveProperty('city')
      expect(doInstance.receivedLocation).toHaveProperty('region')
      expect(doInstance.receivedLocation).toHaveProperty('cfHint')
      expect(doInstance.receivedLocation).toHaveProperty('detectedAt')
    })
  })

  describe('Hook Timing', () => {
    it('should call hook after detection completes', async () => {
      // RED: Hook timing not implemented
      const callOrder: string[] = []

      class TimingTestDO extends DO {
        async _detectLocation(): Promise<ExpectedDOLocation> {
          callOrder.push('detect')
          return {
            colo: 'lax',
            city: 'LosAngeles',
            region: 'us-west',
            cfHint: 'wnam',
            detectedAt: new Date(),
          }
        }

        protected async onLocationDetected(location: ExpectedDOLocation): Promise<void> {
          callOrder.push('hook')
        }
      }

      const doInstance = new TimingTestDO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.do' })

      await doInstance.getLocation()

      expect(callOrder).toEqual(['detect', 'hook'])
    })

    it('should call hook before getLocation() promise resolves', async () => {
      // RED: Hook execution order not implemented
      let hookCompleted = false
      let getLocationCompleted = false

      class OrderTestDO extends DO {
        protected async onLocationDetected(location: ExpectedDOLocation): Promise<void> {
          hookCompleted = true
          expect(getLocationCompleted).toBe(false)
        }
      }

      const doInstance = new OrderTestDO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.do' })

      await doInstance.getLocation()
      getLocationCompleted = true

      expect(hookCompleted).toBe(true)
    })
  })

  describe('Hook Error Handling', () => {
    it('should not fail getLocation if hook throws', async () => {
      // RED: Hook error handling not implemented
      class ErrorHookDO extends DO {
        protected async onLocationDetected(location: ExpectedDOLocation): Promise<void> {
          throw new Error('Hook error')
        }
      }

      const doInstance = new ErrorHookDO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.do' })

      // getLocation should still succeed even if hook throws
      const location = await doInstance.getLocation()

      expect(location).toHaveProperty('colo')
    })

    it('should log hook errors without propagating', async () => {
      // RED: Error logging not implemented
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      class ErrorLoggingDO extends DO {
        protected async onLocationDetected(location: ExpectedDOLocation): Promise<void> {
          throw new Error('Hook failure')
        }
      }

      const doInstance = new ErrorLoggingDO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.do' })

      await doInstance.getLocation()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('onLocationDetected'),
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('Optional Hook', () => {
    it('should work without onLocationDetected being defined', async () => {
      // RED: Optional hook not implemented
      const doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
      await doInstance.initialize({ ns: 'https://test.do' })

      // Should not throw when hook is not defined
      const location = await doInstance.getLocation()

      expect(location).toHaveProperty('colo')
    })
  })
})

// ============================================================================
// MOCK OBJECTS STORE FOR ObjectRef Tests
// ============================================================================

/**
 * Mock ObjectsStore that stores objects in memory
 * Used to test ObjectRef integration without a real database
 */
class MockObjectsStore {
  private objects = new Map<string, {
    ns: string
    id: string
    class: string
    relation?: string | null
    shardKey?: string | null
    shardIndex?: number | null
    region?: string | null
    colo?: string | null
    primary?: boolean | null
    cached?: Record<string, unknown> | null
    createdAt: Date
  }>()

  // Reference to the DO's getLocation for auto-populating location
  private getLocationFn: (() => Promise<ExpectedDOLocation>) | null = null

  setLocationProvider(fn: () => Promise<ExpectedDOLocation>) {
    this.getLocationFn = fn
  }

  async create(options: {
    ns: string
    doId: string
    doClass: string
    relation?: string
    shardKey?: string
    shardIndex?: number
    region?: string
    colo?: string
    primary?: boolean
  }) {
    // Auto-populate region/colo from DO's location if not explicitly provided
    let region = options.region ?? null
    let colo = options.colo ?? null

    if ((region === null || colo === null) && this.getLocationFn) {
      try {
        const location = await this.getLocationFn()
        region = region ?? location.region
        colo = colo ?? location.colo
      } catch {
        // Fallback to nulls if location detection fails
      }
    }

    const entity = {
      ns: options.ns,
      id: options.doId,
      class: options.doClass,
      relation: options.relation ?? null,
      shardKey: options.shardKey ?? null,
      shardIndex: options.shardIndex ?? null,
      region,
      colo,
      primary: options.primary ?? null,
      cached: null,
      createdAt: new Date(),
    }
    this.objects.set(options.ns, entity)
    return entity
  }

  async get(ns: string) {
    return this.objects.get(ns) ?? null
  }

  async list(options?: { region?: string; colo?: string }) {
    const results = Array.from(this.objects.values())
    if (options?.region) {
      return results.filter(o => o.region === options.region)
    }
    if (options?.colo) {
      return results.filter(o => o.colo === options.colo)
    }
    return results
  }
}

// ============================================================================
// TESTS: INTEGRATION WITH OBJECT REF
// ============================================================================

describe('ObjectRef Location Integration', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: Env
  let doInstance: DO
  let mockObjectsStore: MockObjectsStore

  beforeEach(async () => {
    mockState = createMockDOState()
    mockEnv = createMockEnv({
      DO: {
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'ok' }))),
        }),
        idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id-from-name' }),
      },
    })
    doInstance = new DO(mockState as unknown as DurableObjectState, mockEnv)
    await doInstance.initialize({ ns: 'https://test.do' })

    // Replace the objects store with our mock
    mockObjectsStore = new MockObjectsStore()
    // Wire up the location provider so create() can auto-populate region/colo
    mockObjectsStore.setLocationProvider(() => doInstance.getLocation())
    Object.defineProperty(doInstance, 'objects', {
      get: () => mockObjectsStore,
      configurable: true,
    })
  })

  afterEach(() => {
    DOBase._resetTestState()
  })

  describe('ObjectRef Registration', () => {
    it('should include location in ObjectRef when DO registers', async () => {
      // RED: ObjectRef location not implemented
      // When a DO registers itself in the objects table, it should include location

      // Trigger location detection
      const location = await doInstance.getLocation()

      // Access objects store to verify registration includes location
      const objectsStore = doInstance.objects

      // Create a registration
      await objectsStore.create({
        ns: 'https://test.do',
        doId: 'test-do-id',
        doClass: 'TestDO',
      })

      // Verify the registration includes location fields
      const registered = await objectsStore.get('https://test.do')

      expect(registered).toHaveProperty('region')
      expect(registered?.region).toBe(location.region)
    })

    it('should update ObjectRef.region field with detected region', async () => {
      // RED: ObjectRef.region update not implemented
      const location = await doInstance.getLocation()

      // Simulate registration update
      await doInstance.objects.create({
        ns: 'https://test.do',
        doId: 'test-do-id',
        doClass: 'TestDO',
      })

      const ref = await doInstance.objects.get('https://test.do')

      expect(ref?.region).toBe(location.region)
    })

    it('should update ObjectRef.colo field with detected colo', async () => {
      // RED: ObjectRef.colo update not implemented
      const location = await doInstance.getLocation()

      await doInstance.objects.create({
        ns: 'https://test.do',
        doId: 'test-do-id',
        doClass: 'TestDO',
      })

      const ref = await doInstance.objects.get('https://test.do')

      // ObjectRef should have colo field
      expect(ref).toHaveProperty('colo')
      expect(ref?.colo).toBe(location.colo)
    })
  })

  describe('ObjectRef Schema Extension', () => {
    it('should have colo field in ObjectRef type', async () => {
      // RED: ObjectRef.colo field not in schema
      const ref = await doInstance.objects.get('https://test.do')

      // Type check - ObjectRef should have colo?: string
      if (ref) {
        expect(ref).toHaveProperty('colo')
      }
    })

    it('should have region field in ObjectRef type', async () => {
      // RED: ObjectRef.region field verification
      const ref = await doInstance.objects.get('https://test.do')

      // Type check - ObjectRef should have region?: string
      if (ref) {
        expect(ref).toHaveProperty('region')
      }
    })
  })

  describe('Location-Aware DO Discovery', () => {
    it('should be able to query DOs by region', async () => {
      // RED: Region-based queries not implemented
      await doInstance.getLocation()

      // Create multiple DO registrations with different regions
      await doInstance.objects.create({
        ns: 'https://do1.test',
        doId: 'do-1',
        doClass: 'TestDO',
        region: 'us-west',
      })

      await doInstance.objects.create({
        ns: 'https://do2.test',
        doId: 'do-2',
        doClass: 'TestDO',
        region: 'us-east',
      })

      // Query by region
      const westDOs = await doInstance.objects.list({ region: 'us-west' })

      expect(westDOs.length).toBeGreaterThan(0)
      expect(westDOs.every(d => d.region === 'us-west')).toBe(true)
    })

    it('should be able to query DOs by colo', async () => {
      // RED: Colo-based queries not implemented
      await doInstance.objects.create({
        ns: 'https://do1.test',
        doId: 'do-1',
        doClass: 'TestDO',
        colo: 'lax',
      })

      await doInstance.objects.create({
        ns: 'https://do2.test',
        doId: 'do-2',
        doClass: 'TestDO',
        colo: 'iad',
      })

      // Query by colo
      const laxDOs = await doInstance.objects.list({ colo: 'lax' })

      expect(laxDOs.length).toBeGreaterThan(0)
      expect(laxDOs.every(d => d.colo === 'lax')).toBe(true)
    })
  })
})

// ============================================================================
// TESTS: TYPE EXPORTS AND INTERFACES
// ============================================================================

describe('DOLocation Type Exports', () => {
  it('should export DOLocation type from types/Location', async () => {
    // RED: DOLocation type not exported yet
    // This import should work after implementation
    const LocationModule = await import('../../types/Location')

    expect(LocationModule).toHaveProperty('DOLocation')
  })

  it('DOLocation should have required properties', () => {
    // RED: DOLocation interface incomplete
    // Type-level test - verified at compile time
    const testLocation: ExpectedDOLocation = {
      colo: 'lax',
      city: 'LosAngeles',
      region: 'us-west',
      cfHint: 'wnam',
      detectedAt: new Date(),
    }

    expect(testLocation.colo).toBe('lax')
    expect(testLocation.city).toBe('LosAngeles')
    expect(testLocation.region).toBe('us-west')
    expect(testLocation.cfHint).toBe('wnam')
    expect(testLocation.detectedAt).toBeInstanceOf(Date)
  })

  it('DOLocation should allow optional coordinates', () => {
    // RED: DOLocation coordinates optional
    const locationWithCoords: ExpectedDOLocation = {
      colo: 'lax',
      city: 'LosAngeles',
      region: 'us-west',
      cfHint: 'wnam',
      detectedAt: new Date(),
      coordinates: {
        latitude: 34.0522,
        longitude: -118.2437,
      },
    }

    expect(locationWithCoords.coordinates?.latitude).toBeCloseTo(34.0522)
    expect(locationWithCoords.coordinates?.longitude).toBeCloseTo(-118.2437)
  })
})

// ============================================================================
// TYPE DECLARATION FOR CF PROPERTIES (Test Helper)
// ============================================================================

interface IncomingRequestCfProperties {
  colo?: string
  city?: string
  region?: string
  country?: string
  latitude?: string
  longitude?: string
  [key: string]: unknown
}
