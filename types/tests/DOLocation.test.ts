import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest'

/**
 * DOLocation Types Tests (RED Phase)
 *
 * These tests define the type system for Durable Object location detection:
 * - DOLocation interface (base location info for a DO)
 * - DOLocationInfo interface (extended location info with DO metadata)
 * - ColoMetadata interface (external colo data from WHERE-DOs-Live)
 * - createDOLocation factory function
 *
 * Implementation requirements:
 * - Create types/DOLocation.ts with all types and factory
 * - Export from types/index.ts
 *
 * Reference: dotdo-gm44s - DO Location types tests
 */

// ============================================================================
// Import existing types from Location.ts (these should work)
// ============================================================================

import type {
  Region,
  ColoCode,
  ColoCity,
  CFLocationHint,
} from '../Location'

// ============================================================================
// Import the types under test (will fail until implemented)
// ============================================================================

import type {
  DOLocation,
  DOLocationInfo,
  ColoMetadata,
} from '../DOLocation'

import {
  createDOLocation,
} from '../DOLocation'

// ============================================================================
// DOLocation Interface Tests
// ============================================================================

describe('DOLocation Interface', () => {
  describe('required properties', () => {
    it('should have colo property of type ColoCode', () => {
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
      }

      expect(location.colo).toBe('iad')
      expectTypeOf(location.colo).toEqualTypeOf<ColoCode>()
    })

    it('should have city property of type ColoCity', () => {
      const location: DOLocation = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        detectedAt: Date.now(),
      }

      expect(location.city).toBe('LosAngeles')
      expectTypeOf(location.city).toEqualTypeOf<ColoCity>()
    })

    it('should have region property of type Region', () => {
      const location: DOLocation = {
        colo: 'lhr',
        city: 'London',
        region: 'eu-west',
        cfHint: 'weur',
        detectedAt: Date.now(),
      }

      expect(location.region).toBe('eu-west')
      expectTypeOf(location.region).toEqualTypeOf<Region>()
    })

    it('should have cfHint property of type CFLocationHint', () => {
      const location: DOLocation = {
        colo: 'sin',
        city: 'Singapore',
        region: 'asia-pacific',
        cfHint: 'apac',
        detectedAt: Date.now(),
      }

      expect(location.cfHint).toBe('apac')
      expectTypeOf(location.cfHint).toEqualTypeOf<CFLocationHint>()
    })

    it('should have detectedAt property of type number (Unix timestamp)', () => {
      const timestamp = Date.now()
      const location: DOLocation = {
        colo: 'fra',
        city: 'Frankfurt',
        region: 'eu-west',
        cfHint: 'weur',
        detectedAt: timestamp,
      }

      expect(location.detectedAt).toBe(timestamp)
      expectTypeOf(location.detectedAt).toEqualTypeOf<number>()
    })
  })

  describe('optional coordinates property', () => {
    it('should allow coordinates to be omitted', () => {
      const location: DOLocation = {
        colo: 'nrt',
        city: 'Tokyo',
        region: 'asia-pacific',
        cfHint: 'apac',
        detectedAt: Date.now(),
      }

      expect(location.coordinates).toBeUndefined()
    })

    it('should accept coordinates with lat and lng', () => {
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        coordinates: {
          lat: 38.9072,
          lng: -77.0369,
        },
        detectedAt: Date.now(),
      }

      expect(location.coordinates).toBeDefined()
      expect(location.coordinates?.lat).toBe(38.9072)
      expect(location.coordinates?.lng).toBe(-77.0369)
    })

    it('should enforce lat property type as number', () => {
      const location: DOLocation = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        coordinates: {
          lat: 34.0522,
          lng: -118.2437,
        },
        detectedAt: Date.now(),
      }

      expectTypeOf(location.coordinates!.lat).toEqualTypeOf<number>()
    })

    it('should enforce lng property type as number', () => {
      const location: DOLocation = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        coordinates: {
          lat: 34.0522,
          lng: -118.2437,
        },
        detectedAt: Date.now(),
      }

      expectTypeOf(location.coordinates!.lng).toEqualTypeOf<number>()
    })
  })

  describe('type validation', () => {
    it('should not accept invalid colo code', () => {
      // @ts-expect-error - 'xyz' is not a valid ColoCode
      const location: DOLocation = {
        colo: 'xyz',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
      }
      expect(location).toBeDefined()
    })

    it('should not accept invalid city', () => {
      // @ts-expect-error - 'InvalidCity' is not a valid ColoCity
      const location: DOLocation = {
        colo: 'iad',
        city: 'InvalidCity',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
      }
      expect(location).toBeDefined()
    })

    it('should not accept invalid region', () => {
      // @ts-expect-error - 'invalid-region' is not a valid Region
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'invalid-region',
        cfHint: 'enam',
        detectedAt: Date.now(),
      }
      expect(location).toBeDefined()
    })

    it('should not accept invalid cfHint', () => {
      // @ts-expect-error - 'invalid' is not a valid CFLocationHint
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'invalid',
        detectedAt: Date.now(),
      }
      expect(location).toBeDefined()
    })

    it('should not accept string for detectedAt', () => {
      // @ts-expect-error - detectedAt must be a number
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: '2024-01-01',
      }
      expect(location).toBeDefined()
    })
  })

  describe('all colos should be valid', () => {
    const coloTestCases: Array<{ colo: ColoCode; city: ColoCity; region: Region; cfHint: CFLocationHint }> = [
      // US East
      { colo: 'iad', city: 'Virginia', region: 'us-east', cfHint: 'enam' },
      { colo: 'ewr', city: 'Newark', region: 'us-east', cfHint: 'enam' },
      { colo: 'atl', city: 'Atlanta', region: 'us-east', cfHint: 'enam' },
      { colo: 'mia', city: 'Miami', region: 'us-east', cfHint: 'enam' },
      { colo: 'ord', city: 'Chicago', region: 'us-east', cfHint: 'enam' },
      { colo: 'dfw', city: 'Dallas', region: 'us-east', cfHint: 'enam' },
      // US West
      { colo: 'den', city: 'Denver', region: 'us-west', cfHint: 'wnam' },
      { colo: 'sjc', city: 'SanJose', region: 'us-west', cfHint: 'wnam' },
      { colo: 'lax', city: 'LosAngeles', region: 'us-west', cfHint: 'wnam' },
      { colo: 'sea', city: 'Seattle', region: 'us-west', cfHint: 'wnam' },
      // EU West
      { colo: 'lhr', city: 'London', region: 'eu-west', cfHint: 'weur' },
      { colo: 'cdg', city: 'Paris', region: 'eu-west', cfHint: 'weur' },
      { colo: 'ams', city: 'Amsterdam', region: 'eu-west', cfHint: 'weur' },
      { colo: 'fra', city: 'Frankfurt', region: 'eu-west', cfHint: 'weur' },
      { colo: 'mrs', city: 'Marseille', region: 'eu-west', cfHint: 'weur' },
      { colo: 'mxp', city: 'Milan', region: 'eu-west', cfHint: 'weur' },
      // EU East
      { colo: 'prg', city: 'Prague', region: 'eu-east', cfHint: 'eeur' },
      { colo: 'arn', city: 'Stockholm', region: 'eu-east', cfHint: 'eeur' },
      { colo: 'vie', city: 'Vienna', region: 'eu-east', cfHint: 'eeur' },
      // Asia-Pacific
      { colo: 'sin', city: 'Singapore', region: 'asia-pacific', cfHint: 'apac' },
      { colo: 'hkg', city: 'HongKong', region: 'asia-pacific', cfHint: 'apac' },
      { colo: 'nrt', city: 'Tokyo', region: 'asia-pacific', cfHint: 'apac' },
      { colo: 'kix', city: 'Osaka', region: 'asia-pacific', cfHint: 'apac' },
    ]

    it.each(coloTestCases)('should accept DOLocation for $colo ($city)', ({ colo, city, region, cfHint }) => {
      const location: DOLocation = {
        colo,
        city,
        region,
        cfHint,
        detectedAt: Date.now(),
      }

      expect(location.colo).toBe(colo)
      expect(location.city).toBe(city)
      expect(location.region).toBe(region)
      expect(location.cfHint).toBe(cfHint)
    })
  })
})

// ============================================================================
// DOLocationInfo Interface Tests (extends DOLocation)
// ============================================================================

describe('DOLocationInfo Interface', () => {
  describe('extends DOLocation', () => {
    it('should include all DOLocation properties', () => {
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-123456',
        ns: 'MY_DO_NAMESPACE',
      }

      // Base DOLocation properties
      expect(info.colo).toBe('iad')
      expect(info.city).toBe('Virginia')
      expect(info.region).toBe('us-east')
      expect(info.cfHint).toBe('enam')
      expect(info.detectedAt).toBeDefined()
    })

    it('should allow DOLocationInfo to be assigned to DOLocation', () => {
      const info: DOLocationInfo = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        detectedAt: Date.now(),
        doId: 'do-789',
        ns: 'COUNTER_DO',
      }

      // This should work since DOLocationInfo extends DOLocation
      const location: DOLocation = info

      expect(location.colo).toBe('lax')
      expectTypeOf(location).toMatchTypeOf<DOLocation>()
    })

    it('should support optional coordinates from DOLocation', () => {
      const info: DOLocationInfo = {
        colo: 'sin',
        city: 'Singapore',
        region: 'asia-pacific',
        cfHint: 'apac',
        coordinates: {
          lat: 1.3521,
          lng: 103.8198,
        },
        detectedAt: Date.now(),
        doId: 'do-sg-001',
        ns: 'SESSION_DO',
      }

      expect(info.coordinates?.lat).toBe(1.3521)
      expect(info.coordinates?.lng).toBe(103.8198)
    })
  })

  describe('additional DOLocationInfo properties', () => {
    it('should have doId property of type string', () => {
      const info: DOLocationInfo = {
        colo: 'lhr',
        city: 'London',
        region: 'eu-west',
        cfHint: 'weur',
        detectedAt: Date.now(),
        doId: 'do-uk-abc123',
        ns: 'CHAT_ROOM',
      }

      expect(info.doId).toBe('do-uk-abc123')
      expectTypeOf(info.doId).toEqualTypeOf<string>()
    })

    it('should have ns property of type string', () => {
      const info: DOLocationInfo = {
        colo: 'fra',
        city: 'Frankfurt',
        region: 'eu-west',
        cfHint: 'weur',
        detectedAt: Date.now(),
        doId: 'do-de-xyz789',
        ns: 'GAME_STATE',
      }

      expect(info.ns).toBe('GAME_STATE')
      expectTypeOf(info.ns).toEqualTypeOf<string>()
    })

    it('should allow optional likelihood property', () => {
      const infoWithoutLikelihood: DOLocationInfo = {
        colo: 'nrt',
        city: 'Tokyo',
        region: 'asia-pacific',
        cfHint: 'apac',
        detectedAt: Date.now(),
        doId: 'do-jp-001',
        ns: 'ANALYTICS',
      }

      expect(infoWithoutLikelihood.likelihood).toBeUndefined()
    })

    it('should accept likelihood as number between 0 and 1', () => {
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-us-high-confidence',
        ns: 'USER_SESSION',
        likelihood: 0.95,
      }

      expect(info.likelihood).toBe(0.95)
      expectTypeOf(info.likelihood).toEqualTypeOf<number | undefined>()
    })

    it('should accept likelihood of 0', () => {
      const info: DOLocationInfo = {
        colo: 'sea',
        city: 'Seattle',
        region: 'us-west',
        cfHint: 'wnam',
        detectedAt: Date.now(),
        doId: 'do-low-confidence',
        ns: 'TEST_DO',
        likelihood: 0,
      }

      expect(info.likelihood).toBe(0)
    })

    it('should accept likelihood of 1', () => {
      const info: DOLocationInfo = {
        colo: 'ams',
        city: 'Amsterdam',
        region: 'eu-west',
        cfHint: 'weur',
        detectedAt: Date.now(),
        doId: 'do-certain',
        ns: 'VERIFIED_DO',
        likelihood: 1,
      }

      expect(info.likelihood).toBe(1)
    })
  })

  describe('type validation', () => {
    it('should require doId property', () => {
      // @ts-expect-error - doId is required
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        ns: 'MY_DO',
      }
      expect(info).toBeDefined()
    })

    it('should require ns property', () => {
      // @ts-expect-error - ns is required
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-123',
      }
      expect(info).toBeDefined()
    })

    it('should not accept non-string doId', () => {
      // @ts-expect-error - doId must be string
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 12345,
        ns: 'MY_DO',
      }
      expect(info).toBeDefined()
    })

    it('should not accept non-string ns', () => {
      // @ts-expect-error - ns must be string
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-123',
        ns: 12345,
      }
      expect(info).toBeDefined()
    })

    it('should not accept non-number likelihood', () => {
      // @ts-expect-error - likelihood must be number
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-123',
        ns: 'MY_DO',
        likelihood: 'high',
      }
      expect(info).toBeDefined()
    })
  })
})

// ============================================================================
// ColoMetadata Interface Tests
// ============================================================================

describe('ColoMetadata Interface', () => {
  describe('required properties', () => {
    it('should have code property of type ColoCode', () => {
      const metadata: ColoMetadata = {
        code: 'iad',
        city: 'Virginia',
        region: 'us-east',
        coordinates: { lat: 38.9072, lng: -77.0369 },
        supportsDOs: true,
      }

      expect(metadata.code).toBe('iad')
      expectTypeOf(metadata.code).toEqualTypeOf<ColoCode>()
    })

    it('should have city property of type ColoCity', () => {
      const metadata: ColoMetadata = {
        code: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        coordinates: { lat: 34.0522, lng: -118.2437 },
        supportsDOs: true,
      }

      expect(metadata.city).toBe('LosAngeles')
      expectTypeOf(metadata.city).toEqualTypeOf<ColoCity>()
    })

    it('should have region property of type Region', () => {
      const metadata: ColoMetadata = {
        code: 'lhr',
        city: 'London',
        region: 'eu-west',
        coordinates: { lat: 51.5074, lng: -0.1278 },
        supportsDOs: true,
      }

      expect(metadata.region).toBe('eu-west')
      expectTypeOf(metadata.region).toEqualTypeOf<Region>()
    })

    it('should have coordinates property with lat and lng', () => {
      const metadata: ColoMetadata = {
        code: 'sin',
        city: 'Singapore',
        region: 'asia-pacific',
        coordinates: { lat: 1.3521, lng: 103.8198 },
        supportsDOs: true,
      }

      expect(metadata.coordinates.lat).toBe(1.3521)
      expect(metadata.coordinates.lng).toBe(103.8198)
      expectTypeOf(metadata.coordinates.lat).toEqualTypeOf<number>()
      expectTypeOf(metadata.coordinates.lng).toEqualTypeOf<number>()
    })

    it('should have supportsDOs property of type boolean', () => {
      const metadataSupported: ColoMetadata = {
        code: 'iad',
        city: 'Virginia',
        region: 'us-east',
        coordinates: { lat: 38.9072, lng: -77.0369 },
        supportsDOs: true,
      }

      const metadataNotSupported: ColoMetadata = {
        code: 'mia',
        city: 'Miami',
        region: 'us-east',
        coordinates: { lat: 25.7617, lng: -80.1918 },
        supportsDOs: false,
      }

      expect(metadataSupported.supportsDOs).toBe(true)
      expect(metadataNotSupported.supportsDOs).toBe(false)
      expectTypeOf(metadataSupported.supportsDOs).toEqualTypeOf<boolean>()
    })
  })

  describe('optional properties', () => {
    it('should allow likelihood to be omitted', () => {
      const metadata: ColoMetadata = {
        code: 'fra',
        city: 'Frankfurt',
        region: 'eu-west',
        coordinates: { lat: 50.1109, lng: 8.6821 },
        supportsDOs: true,
      }

      expect(metadata.likelihood).toBeUndefined()
    })

    it('should accept likelihood as number', () => {
      const metadata: ColoMetadata = {
        code: 'iad',
        city: 'Virginia',
        region: 'us-east',
        coordinates: { lat: 38.9072, lng: -77.0369 },
        supportsDOs: true,
        likelihood: 0.85,
      }

      expect(metadata.likelihood).toBe(0.85)
      expectTypeOf(metadata.likelihood).toEqualTypeOf<number | undefined>()
    })
  })

  describe('type validation', () => {
    it('should require coordinates property', () => {
      // @ts-expect-error - coordinates is required
      const metadata: ColoMetadata = {
        code: 'iad',
        city: 'Virginia',
        region: 'us-east',
        supportsDOs: true,
      }
      expect(metadata).toBeDefined()
    })

    it('should require supportsDOs property', () => {
      // @ts-expect-error - supportsDOs is required
      const metadata: ColoMetadata = {
        code: 'iad',
        city: 'Virginia',
        region: 'us-east',
        coordinates: { lat: 38.9072, lng: -77.0369 },
      }
      expect(metadata).toBeDefined()
    })

    it('should not accept invalid colo code', () => {
      // @ts-expect-error - 'xyz' is not a valid ColoCode
      const metadata: ColoMetadata = {
        code: 'xyz',
        city: 'Virginia',
        region: 'us-east',
        coordinates: { lat: 38.9072, lng: -77.0369 },
        supportsDOs: true,
      }
      expect(metadata).toBeDefined()
    })

    it('should not accept non-boolean supportsDOs', () => {
      // @ts-expect-error - supportsDOs must be boolean
      const metadata: ColoMetadata = {
        code: 'iad',
        city: 'Virginia',
        region: 'us-east',
        coordinates: { lat: 38.9072, lng: -77.0369 },
        supportsDOs: 'yes',
      }
      expect(metadata).toBeDefined()
    })

    it('should require both lat and lng in coordinates', () => {
      // @ts-expect-error - coordinates requires both lat and lng
      const metadata: ColoMetadata = {
        code: 'iad',
        city: 'Virginia',
        region: 'us-east',
        coordinates: { lat: 38.9072 },
        supportsDOs: true,
      }
      expect(metadata).toBeDefined()
    })
  })

  describe('all DO-supported colos', () => {
    const doSupportedColos: Array<{ code: ColoCode; city: ColoCity; region: Region }> = [
      { code: 'iad', city: 'Virginia', region: 'us-east' },
      { code: 'lax', city: 'LosAngeles', region: 'us-west' },
      { code: 'lhr', city: 'London', region: 'eu-west' },
      { code: 'sin', city: 'Singapore', region: 'asia-pacific' },
    ]

    it.each(doSupportedColos)('should create valid ColoMetadata for DO-supported $code', ({ code, city, region }) => {
      const metadata: ColoMetadata = {
        code,
        city,
        region,
        coordinates: { lat: 0, lng: 0 },
        supportsDOs: true,
      }

      expect(metadata.code).toBe(code)
      expect(metadata.supportsDOs).toBe(true)
    })
  })
})

// ============================================================================
// Type Compatibility with Location.ts Tests
// ============================================================================

describe('Type Compatibility with Location.ts', () => {
  it('should use ColoCode from Location.ts in DOLocation', () => {
    const code: ColoCode = 'iad'
    const location: DOLocation = {
      colo: code,
      city: 'Virginia',
      region: 'us-east',
      cfHint: 'enam',
      detectedAt: Date.now(),
    }

    expect(location.colo).toBe(code)
  })

  it('should use ColoCity from Location.ts in DOLocation', () => {
    const city: ColoCity = 'LosAngeles'
    const location: DOLocation = {
      colo: 'lax',
      city: city,
      region: 'us-west',
      cfHint: 'wnam',
      detectedAt: Date.now(),
    }

    expect(location.city).toBe(city)
  })

  it('should use Region from Location.ts in DOLocation', () => {
    const region: Region = 'eu-west'
    const location: DOLocation = {
      colo: 'lhr',
      city: 'London',
      region: region,
      cfHint: 'weur',
      detectedAt: Date.now(),
    }

    expect(location.region).toBe(region)
  })

  it('should use CFLocationHint from Location.ts in DOLocation', () => {
    const hint: CFLocationHint = 'apac'
    const location: DOLocation = {
      colo: 'sin',
      city: 'Singapore',
      region: 'asia-pacific',
      cfHint: hint,
      detectedAt: Date.now(),
    }

    expect(location.cfHint).toBe(hint)
  })

  it('should use ColoCode from Location.ts in ColoMetadata', () => {
    const code: ColoCode = 'fra'
    const metadata: ColoMetadata = {
      code: code,
      city: 'Frankfurt',
      region: 'eu-west',
      coordinates: { lat: 50.1109, lng: 8.6821 },
      supportsDOs: true,
    }

    expect(metadata.code).toBe(code)
  })
})

// ============================================================================
// createDOLocation Factory Function Tests
// ============================================================================

describe('createDOLocation Factory Function', () => {
  describe('import/export', () => {
    it('should be exported from DOLocation module', () => {
      expect(createDOLocation).toBeDefined()
      expect(typeof createDOLocation).toBe('function')
    })
  })

  describe('basic creation', () => {
    it('should create DOLocation with colo code', () => {
      const location = createDOLocation('iad')

      expect(location.colo).toBe('iad')
      expect(location.city).toBe('Virginia')
      expect(location.region).toBe('us-east')
      expect(location.cfHint).toBe('enam')
      expect(location.detectedAt).toBeDefined()
    })

    it('should create DOLocation with city name', () => {
      const location = createDOLocation('LosAngeles')

      expect(location.colo).toBe('lax')
      expect(location.city).toBe('LosAngeles')
      expect(location.region).toBe('us-west')
      expect(location.cfHint).toBe('wnam')
    })

    it('should set detectedAt to current timestamp', () => {
      const before = Date.now()
      const location = createDOLocation('lhr')
      const after = Date.now()

      expect(location.detectedAt).toBeGreaterThanOrEqual(before)
      expect(location.detectedAt).toBeLessThanOrEqual(after)
    })

    it('should return DOLocation type', () => {
      const location = createDOLocation('sin')

      expectTypeOf(location).toMatchTypeOf<DOLocation>()
    })
  })

  describe('with optional coordinates', () => {
    it('should include coordinates when provided', () => {
      const location = createDOLocation('iad', {
        coordinates: { lat: 38.9072, lng: -77.0369 },
      })

      expect(location.coordinates).toBeDefined()
      expect(location.coordinates?.lat).toBe(38.9072)
      expect(location.coordinates?.lng).toBe(-77.0369)
    })

    it('should not include coordinates when not provided', () => {
      const location = createDOLocation('lax')

      expect(location.coordinates).toBeUndefined()
    })
  })

  describe('with custom timestamp', () => {
    it('should use provided timestamp', () => {
      const customTimestamp = 1704067200000 // 2024-01-01T00:00:00.000Z
      const location = createDOLocation('fra', {
        detectedAt: customTimestamp,
      })

      expect(location.detectedAt).toBe(customTimestamp)
    })
  })

  describe('all colos', () => {
    const allColos: ColoCode[] = [
      'iad', 'ewr', 'atl', 'mia', 'ord', 'dfw',
      'den', 'sjc', 'lax', 'sea',
      'lhr', 'cdg', 'ams', 'fra', 'mrs', 'mxp',
      'prg', 'arn', 'vie',
      'sin', 'hkg', 'nrt', 'kix',
    ]

    it.each(allColos)('should create valid DOLocation for %s', (colo) => {
      const location = createDOLocation(colo)

      expect(location.colo).toBe(colo)
      expect(location.city).toBeDefined()
      expect(location.region).toBeDefined()
      expect(location.cfHint).toBeDefined()
      expect(location.detectedAt).toBeDefined()
    })
  })
})

// ============================================================================
// Validation Tests for Required vs Optional Fields
// ============================================================================

describe('Validation: Required vs Optional Fields', () => {
  describe('DOLocation required fields', () => {
    it('should fail without colo', () => {
      // @ts-expect-error - colo is required
      const location: DOLocation = {
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
      }
      expect(location).toBeDefined()
    })

    it('should fail without city', () => {
      // @ts-expect-error - city is required
      const location: DOLocation = {
        colo: 'iad',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
      }
      expect(location).toBeDefined()
    })

    it('should fail without region', () => {
      // @ts-expect-error - region is required
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        cfHint: 'enam',
        detectedAt: Date.now(),
      }
      expect(location).toBeDefined()
    })

    it('should fail without cfHint', () => {
      // @ts-expect-error - cfHint is required
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        detectedAt: Date.now(),
      }
      expect(location).toBeDefined()
    })

    it('should fail without detectedAt', () => {
      // @ts-expect-error - detectedAt is required
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
      }
      expect(location).toBeDefined()
    })
  })

  describe('DOLocation optional fields', () => {
    it('should pass without coordinates', () => {
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
      }

      expect(location.coordinates).toBeUndefined()
    })
  })

  describe('DOLocationInfo required fields', () => {
    it('should require doId in addition to DOLocation fields', () => {
      // @ts-expect-error - doId is required
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        ns: 'MY_DO',
      }
      expect(info).toBeDefined()
    })

    it('should require ns in addition to DOLocation fields', () => {
      // @ts-expect-error - ns is required
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-123',
      }
      expect(info).toBeDefined()
    })
  })

  describe('DOLocationInfo optional fields', () => {
    it('should pass without likelihood', () => {
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-123',
        ns: 'MY_DO',
      }

      expect(info.likelihood).toBeUndefined()
    })
  })

  describe('ColoMetadata required fields', () => {
    it('should require all core properties', () => {
      // @ts-expect-error - missing required properties
      const metadata: ColoMetadata = {
        code: 'iad',
      }
      expect(metadata).toBeDefined()
    })

    it('should require coordinates (not optional like DOLocation)', () => {
      // @ts-expect-error - coordinates is required for ColoMetadata
      const metadata: ColoMetadata = {
        code: 'iad',
        city: 'Virginia',
        region: 'us-east',
        supportsDOs: true,
      }
      expect(metadata).toBeDefined()
    })
  })

  describe('ColoMetadata optional fields', () => {
    it('should pass without likelihood', () => {
      const metadata: ColoMetadata = {
        code: 'iad',
        city: 'Virginia',
        region: 'us-east',
        coordinates: { lat: 38.9072, lng: -77.0369 },
        supportsDOs: true,
      }

      expect(metadata.likelihood).toBeUndefined()
    })
  })
})

// ============================================================================
// Edge Cases and Boundary Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('timestamp handling', () => {
    it('should accept 0 as valid timestamp', () => {
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: 0,
      }

      expect(location.detectedAt).toBe(0)
    })

    it('should accept very large timestamp', () => {
      const futureTimestamp = 4102444800000 // Year 2100
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: futureTimestamp,
      }

      expect(location.detectedAt).toBe(futureTimestamp)
    })
  })

  describe('coordinates edge cases', () => {
    it('should accept 0,0 coordinates (null island)', () => {
      const location: DOLocation = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        coordinates: { lat: 0, lng: 0 },
        detectedAt: Date.now(),
      }

      expect(location.coordinates?.lat).toBe(0)
      expect(location.coordinates?.lng).toBe(0)
    })

    it('should accept negative coordinates', () => {
      const location: DOLocation = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        coordinates: { lat: 34.0522, lng: -118.2437 },
        detectedAt: Date.now(),
      }

      expect(location.coordinates?.lat).toBe(34.0522)
      expect(location.coordinates?.lng).toBe(-118.2437)
    })

    it('should accept extreme latitude values', () => {
      const location: DOLocation = {
        colo: 'arn',
        city: 'Stockholm',
        region: 'eu-east',
        cfHint: 'eeur',
        coordinates: { lat: 89.99, lng: 18.0686 },
        detectedAt: Date.now(),
      }

      expect(location.coordinates?.lat).toBe(89.99)
    })
  })

  describe('likelihood edge cases', () => {
    it('should accept 0 likelihood', () => {
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-zero',
        ns: 'TEST',
        likelihood: 0,
      }

      expect(info.likelihood).toBe(0)
    })

    it('should accept 1 likelihood', () => {
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-certain',
        ns: 'TEST',
        likelihood: 1,
      }

      expect(info.likelihood).toBe(1)
    })

    it('should accept fractional likelihood', () => {
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-partial',
        ns: 'TEST',
        likelihood: 0.123456789,
      }

      expect(info.likelihood).toBe(0.123456789)
    })
  })

  describe('string property edge cases', () => {
    it('should accept empty string doId', () => {
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: '',
        ns: 'TEST',
      }

      expect(info.doId).toBe('')
    })

    it('should accept empty string ns', () => {
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: 'do-123',
        ns: '',
      }

      expect(info.ns).toBe('')
    })

    it('should accept long doId', () => {
      const longId = 'do-' + 'a'.repeat(1000)
      const info: DOLocationInfo = {
        colo: 'iad',
        city: 'Virginia',
        region: 'us-east',
        cfHint: 'enam',
        detectedAt: Date.now(),
        doId: longId,
        ns: 'TEST',
      }

      expect(info.doId).toBe(longId)
    })
  })
})
