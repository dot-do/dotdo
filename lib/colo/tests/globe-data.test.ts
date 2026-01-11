/**
 * Globe Visualization Coordinate Data Tests (RED Phase)
 *
 * Issue: dotdo-q7o58 - Export colo coordinates for @mdxui/globe package
 *
 * These tests define the data structures and functions needed to visualize
 * DO (Durable Object) distribution on a 3D globe using the COBE library.
 *
 * TDD RED Phase: All tests should FAIL with NOT IMPLEMENTED errors.
 *
 * Key exports:
 * - GlobeMarker interface: Marker data for COBE globe
 * - coloToGlobeMarker(): Convert ColoMetadata to GlobeMarker
 * - getAllGlobeMarkers(): Get markers for all colos
 * - distributionToMarkers(): Convert DO distribution to sized markers
 * - COLO_COORDINATES: Static coordinates for all DO colos
 * - GlobeArc interface: Arc connections between colos
 * - createConnectionArc(): Create arc between two colos
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Import types from existing modules
// ============================================================================

import type {
  Region,
  ColoCode,
  ColoCity,
} from '../../../types/Location'

// ============================================================================
// Import the module under test (will fail until implemented)
// ============================================================================

import {
  coloToGlobeMarker,
  getAllGlobeMarkers,
  distributionToMarkers,
  createConnectionArc,
  COLO_COORDINATES,
  type GlobeMarker,
  type GlobeArc,
  type DODistribution,
  type ColoDataClient,
} from '../globe-data'

import type { ColoMetadata } from '../../../types/DOLocation'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Sample ColoMetadata for testing
 */
const sampleColoMetadata: ColoMetadata = {
  code: 'lax',
  city: 'LosAngeles',
  region: 'us-west',
  coordinates: { lat: 33.9425, lng: -118.408 },
  supportsDOs: true,
}

const iadColoMetadata: ColoMetadata = {
  code: 'iad',
  city: 'Virginia',
  region: 'us-east',
  coordinates: { lat: 38.9445, lng: -77.4558 },
  supportsDOs: true,
}

const lhrColoMetadata: ColoMetadata = {
  code: 'lhr',
  city: 'London',
  region: 'eu-west',
  coordinates: { lat: 51.4700, lng: -0.4543 },
  supportsDOs: true,
}

const sinColoMetadata: ColoMetadata = {
  code: 'sin',
  city: 'Singapore',
  region: 'asia-pacific',
  coordinates: { lat: 1.3644, lng: 103.9915 },
  supportsDOs: true,
}

const nonDoColoMetadata: ColoMetadata = {
  code: 'mia',
  city: 'Miami',
  region: 'us-east',
  coordinates: { lat: 25.7617, lng: -80.1918 },
  supportsDOs: false,
}

/**
 * Mock ColoDataClient for testing getAllGlobeMarkers
 */
class MockColoDataClient implements ColoDataClient {
  private colos: ColoMetadata[]

  constructor(colos: ColoMetadata[]) {
    this.colos = colos
  }

  async getAllColos(): Promise<ColoMetadata[]> {
    return this.colos
  }

  async getDoSupportedColos(): Promise<ColoMetadata[]> {
    return this.colos.filter((c) => c.supportsDOs)
  }
}

// ============================================================================
// GlobeMarker Interface Tests
// ============================================================================

describe('GlobeMarker Interface', () => {
  describe('required properties', () => {
    it('should have location as [lat, lng] tuple for COBE', () => {
      const marker: GlobeMarker = {
        location: [33.9425, -118.408],
        size: 0.05,
      }

      expect(marker.location).toEqual([33.9425, -118.408])
      expect(marker.location[0]).toBe(33.9425)
      expect(marker.location[1]).toBe(-118.408)
    })

    it('should have size property (0.01-0.1 typical range)', () => {
      const marker: GlobeMarker = {
        location: [38.9445, -77.4558],
        size: 0.05,
      }

      expect(marker.size).toBe(0.05)
      expect(marker.size).toBeGreaterThanOrEqual(0.01)
      expect(marker.size).toBeLessThanOrEqual(0.1)
    })
  })

  describe('optional properties', () => {
    it('should allow optional label', () => {
      const markerWithLabel: GlobeMarker = {
        location: [33.9425, -118.408],
        size: 0.05,
        label: 'LAX',
      }

      const markerWithoutLabel: GlobeMarker = {
        location: [33.9425, -118.408],
        size: 0.05,
      }

      expect(markerWithLabel.label).toBe('LAX')
      expect(markerWithoutLabel.label).toBeUndefined()
    })

    it('should allow optional color', () => {
      const markerWithColor: GlobeMarker = {
        location: [33.9425, -118.408],
        size: 0.05,
        color: '#ff6b6b',
      }

      const markerWithoutColor: GlobeMarker = {
        location: [33.9425, -118.408],
        size: 0.05,
      }

      expect(markerWithColor.color).toBe('#ff6b6b')
      expect(markerWithoutColor.color).toBeUndefined()
    })

    it('should allow optional metadata with colo info', () => {
      const marker: GlobeMarker = {
        location: [33.9425, -118.408],
        size: 0.05,
        metadata: {
          colo: 'lax',
          city: 'LosAngeles',
          region: 'us-west',
        },
      }

      expect(marker.metadata).toBeDefined()
      expect(marker.metadata?.colo).toBe('lax')
      expect(marker.metadata?.city).toBe('LosAngeles')
      expect(marker.metadata?.region).toBe('us-west')
    })

    it('should allow optional doCount in metadata', () => {
      const marker: GlobeMarker = {
        location: [33.9425, -118.408],
        size: 0.08,
        metadata: {
          colo: 'lax',
          city: 'LosAngeles',
          region: 'us-west',
          doCount: 150,
        },
      }

      expect(marker.metadata?.doCount).toBe(150)
    })
  })

  describe('type validation', () => {
    it('should enforce location as exactly 2-element tuple', () => {
      const marker: GlobeMarker = {
        location: [51.4700, -0.4543],
        size: 0.05,
      }

      expect(marker.location.length).toBe(2)
    })

    it('should accept negative coordinates', () => {
      const marker: GlobeMarker = {
        location: [-33.8688, 151.2093], // Sydney
        size: 0.05,
      }

      expect(marker.location[0]).toBe(-33.8688)
      expect(marker.location[1]).toBe(151.2093)
    })
  })
})

// ============================================================================
// coloToGlobeMarker Function Tests
// ============================================================================

describe('coloToGlobeMarker', () => {
  describe('basic conversion', () => {
    it('should convert ColoMetadata to GlobeMarker', () => {
      const marker = coloToGlobeMarker(sampleColoMetadata)

      expect(marker).toBeDefined()
      expect(marker.location).toBeDefined()
      expect(marker.size).toBeDefined()
    })

    it('should use coordinates from metadata', () => {
      const marker = coloToGlobeMarker(sampleColoMetadata)

      expect(marker.location[0]).toBe(33.9425)
      expect(marker.location[1]).toBe(-118.408)
    })

    it('should set default size', () => {
      const marker = coloToGlobeMarker(sampleColoMetadata)

      expect(marker.size).toBeGreaterThan(0)
      expect(marker.size).toBeLessThanOrEqual(0.1)
    })

    it('should include metadata with colo info', () => {
      const marker = coloToGlobeMarker(sampleColoMetadata)

      expect(marker.metadata?.colo).toBe('lax')
      expect(marker.metadata?.city).toBe('LosAngeles')
      expect(marker.metadata?.region).toBe('us-west')
    })
  })

  describe('with options', () => {
    it('should use custom size when provided', () => {
      const marker = coloToGlobeMarker(sampleColoMetadata, { size: 0.08 })

      expect(marker.size).toBe(0.08)
    })

    it('should use custom color when provided', () => {
      const marker = coloToGlobeMarker(sampleColoMetadata, { color: '#4ecdc4' })

      expect(marker.color).toBe('#4ecdc4')
    })

    it('should include label when includeLabel is true', () => {
      const marker = coloToGlobeMarker(sampleColoMetadata, { includeLabel: true })

      expect(marker.label).toBe('LAX')
    })

    it('should not include label when includeLabel is false', () => {
      const marker = coloToGlobeMarker(sampleColoMetadata, { includeLabel: false })

      expect(marker.label).toBeUndefined()
    })

    it('should not include label by default', () => {
      const marker = coloToGlobeMarker(sampleColoMetadata)

      expect(marker.label).toBeUndefined()
    })
  })

  describe('different colos', () => {
    it('should convert IAD colo correctly', () => {
      const marker = coloToGlobeMarker(iadColoMetadata)

      expect(marker.location[0]).toBe(38.9445)
      expect(marker.location[1]).toBe(-77.4558)
      expect(marker.metadata?.colo).toBe('iad')
      expect(marker.metadata?.city).toBe('Virginia')
    })

    it('should convert LHR colo correctly', () => {
      const marker = coloToGlobeMarker(lhrColoMetadata)

      expect(marker.location[0]).toBe(51.4700)
      expect(marker.location[1]).toBe(-0.4543)
      expect(marker.metadata?.colo).toBe('lhr')
      expect(marker.metadata?.region).toBe('eu-west')
    })

    it('should convert SIN colo correctly', () => {
      const marker = coloToGlobeMarker(sinColoMetadata)

      expect(marker.location[0]).toBe(1.3644)
      expect(marker.location[1]).toBe(103.9915)
      expect(marker.metadata?.colo).toBe('sin')
      expect(marker.metadata?.region).toBe('asia-pacific')
    })
  })

  describe('return type', () => {
    it('should return GlobeMarker type', () => {
      const marker: GlobeMarker = coloToGlobeMarker(sampleColoMetadata)

      expect(marker.location).toBeInstanceOf(Array)
      expect(typeof marker.size).toBe('number')
    })
  })
})

// ============================================================================
// getAllGlobeMarkers Function Tests
// ============================================================================

describe('getAllGlobeMarkers', () => {
  let mockClient: MockColoDataClient

  beforeEach(() => {
    mockClient = new MockColoDataClient([
      sampleColoMetadata,
      iadColoMetadata,
      lhrColoMetadata,
      sinColoMetadata,
      nonDoColoMetadata,
    ])
  })

  describe('basic retrieval', () => {
    it('should return markers for all colos', async () => {
      const markers = await getAllGlobeMarkers(mockClient)

      expect(markers).toBeInstanceOf(Array)
      expect(markers.length).toBe(5)
    })

    it('should return GlobeMarker objects', async () => {
      const markers = await getAllGlobeMarkers(mockClient)

      markers.forEach((marker) => {
        expect(marker.location).toBeDefined()
        expect(marker.location.length).toBe(2)
        expect(marker.size).toBeDefined()
      })
    })
  })

  describe('filtering options', () => {
    it('should filter to DO-supporting colos only when doColsOnly is true', async () => {
      const markers = await getAllGlobeMarkers(mockClient, { doColsOnly: true })

      expect(markers.length).toBe(4) // Excludes Miami which has supportsDOs: false
      markers.forEach((marker) => {
        expect(marker.metadata?.colo).not.toBe('mia')
      })
    })

    it('should include all colos when doColsOnly is false', async () => {
      const markers = await getAllGlobeMarkers(mockClient, { doColsOnly: false })

      expect(markers.length).toBe(5)
    })

    it('should include all colos by default', async () => {
      const markers = await getAllGlobeMarkers(mockClient)

      expect(markers.length).toBe(5)
    })
  })

  describe('marker consistency', () => {
    it('should use consistent marker sizes', async () => {
      const markers = await getAllGlobeMarkers(mockClient)

      const sizes = new Set(markers.map((m) => m.size))
      // All markers should have the same default size unless customized
      expect(sizes.size).toBe(1)
    })

    it('should include metadata for all markers', async () => {
      const markers = await getAllGlobeMarkers(mockClient)

      markers.forEach((marker) => {
        expect(marker.metadata).toBeDefined()
        expect(marker.metadata?.colo).toBeDefined()
        expect(marker.metadata?.city).toBeDefined()
        expect(marker.metadata?.region).toBeDefined()
      })
    })
  })

  describe('return type', () => {
    it('should return Promise<GlobeMarker[]>', async () => {
      const markers = await getAllGlobeMarkers(mockClient)

      expect(Array.isArray(markers)).toBe(true)
    })
  })
})

// ============================================================================
// DODistribution and distributionToMarkers Tests
// ============================================================================

describe('DODistribution Interface', () => {
  it('should have colo property of type ColoCode', () => {
    const distribution: DODistribution = {
      colo: 'lax',
      count: 100,
      lastActive: new Date(),
    }

    expect(distribution.colo).toBe('lax')
  })

  it('should have count property of type number', () => {
    const distribution: DODistribution = {
      colo: 'iad',
      count: 250,
      lastActive: new Date(),
    }

    expect(distribution.count).toBe(250)
  })

  it('should have lastActive property of type Date', () => {
    const now = new Date()
    const distribution: DODistribution = {
      colo: 'lhr',
      count: 75,
      lastActive: now,
    }

    expect(distribution.lastActive).toBe(now)
    expect(distribution.lastActive).toBeInstanceOf(Date)
  })
})

describe('distributionToMarkers', () => {
  const coloMetadataMap = new Map<ColoCode, ColoMetadata>([
    ['lax', sampleColoMetadata],
    ['iad', iadColoMetadata],
    ['lhr', lhrColoMetadata],
    ['sin', sinColoMetadata],
  ])

  describe('basic conversion', () => {
    it('should convert distributions to markers', () => {
      const distributions: DODistribution[] = [
        { colo: 'lax', count: 100, lastActive: new Date() },
        { colo: 'iad', count: 200, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, coloMetadataMap)

      expect(markers).toBeInstanceOf(Array)
      expect(markers.length).toBe(2)
    })

    it('should use colo coordinates from metadata map', () => {
      const distributions: DODistribution[] = [
        { colo: 'lax', count: 100, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, coloMetadataMap)

      expect(markers[0].location[0]).toBe(33.9425)
      expect(markers[0].location[1]).toBe(-118.408)
    })
  })

  describe('size based on DO count', () => {
    it('should size markers based on DO count', () => {
      const distributions: DODistribution[] = [
        { colo: 'lax', count: 50, lastActive: new Date() },
        { colo: 'iad', count: 200, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, coloMetadataMap)

      const laxMarker = markers.find((m) => m.metadata?.colo === 'lax')
      const iadMarker = markers.find((m) => m.metadata?.colo === 'iad')

      // Higher count should result in larger marker
      expect(iadMarker!.size).toBeGreaterThan(laxMarker!.size)
    })

    it('should use minimum size for low counts', () => {
      const distributions: DODistribution[] = [
        { colo: 'lax', count: 1, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, coloMetadataMap)

      expect(markers[0].size).toBeGreaterThanOrEqual(0.01)
    })

    it('should use maximum size for high counts', () => {
      const distributions: DODistribution[] = [
        { colo: 'lax', count: 10000, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, coloMetadataMap)

      expect(markers[0].size).toBeLessThanOrEqual(0.1)
    })
  })

  describe('metadata inclusion', () => {
    it('should include count in metadata', () => {
      const distributions: DODistribution[] = [
        { colo: 'lax', count: 150, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, coloMetadataMap)

      expect(markers[0].metadata?.doCount).toBe(150)
    })

    it('should include colo info in metadata', () => {
      const distributions: DODistribution[] = [
        { colo: 'iad', count: 100, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, coloMetadataMap)

      expect(markers[0].metadata?.colo).toBe('iad')
      expect(markers[0].metadata?.city).toBe('Virginia')
      expect(markers[0].metadata?.region).toBe('us-east')
    })
  })

  describe('unknown colo handling', () => {
    it('should handle unknown colos gracefully', () => {
      const distributions: DODistribution[] = [
        { colo: 'xyz' as ColoCode, count: 100, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, coloMetadataMap)

      // Should return empty array or skip unknown colos
      expect(markers.length).toBe(0)
    })

    it('should process known colos and skip unknown ones', () => {
      const distributions: DODistribution[] = [
        { colo: 'lax', count: 100, lastActive: new Date() },
        { colo: 'unknown' as ColoCode, count: 50, lastActive: new Date() },
        { colo: 'iad', count: 75, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, coloMetadataMap)

      expect(markers.length).toBe(2)
      expect(markers.map((m) => m.metadata?.colo)).toContain('lax')
      expect(markers.map((m) => m.metadata?.colo)).toContain('iad')
    })
  })

  describe('empty input handling', () => {
    it('should return empty array for empty distributions', () => {
      const markers = distributionToMarkers([], coloMetadataMap)

      expect(markers).toEqual([])
    })

    it('should return empty array for empty metadata map', () => {
      const distributions: DODistribution[] = [
        { colo: 'lax', count: 100, lastActive: new Date() },
      ]

      const markers = distributionToMarkers(distributions, new Map())

      expect(markers).toEqual([])
    })
  })
})

// ============================================================================
// COLO_COORDINATES Constant Tests
// ============================================================================

describe('COLO_COORDINATES', () => {
  describe('structure', () => {
    it('should be a Record<ColoCode, { lat: number; lng: number }>', () => {
      expect(COLO_COORDINATES).toBeDefined()
      expect(typeof COLO_COORDINATES).toBe('object')
    })

    it('should have lat and lng for each entry', () => {
      Object.values(COLO_COORDINATES).forEach((coords) => {
        expect(coords).toHaveProperty('lat')
        expect(coords).toHaveProperty('lng')
        expect(typeof coords.lat).toBe('number')
        expect(typeof coords.lng).toBe('number')
      })
    })
  })

  describe('DO colo coverage', () => {
    const doColos: ColoCode[] = [
      // US West
      'lax', 'sjc', 'sea', 'den',
      // US East
      'iad', 'ewr', 'ord', 'dfw', 'atl', 'mia',
      // EU West
      'lhr', 'cdg', 'ams', 'fra', 'mrs', 'mxp',
      // EU East
      'prg', 'arn', 'vie',
      // Asia-Pacific
      'sin', 'hkg', 'nrt', 'kix',
    ]

    it('should have coordinates for all DO colos', () => {
      doColos.forEach((colo) => {
        expect(COLO_COORDINATES[colo]).toBeDefined()
        expect(COLO_COORDINATES[colo].lat).toBeDefined()
        expect(COLO_COORDINATES[colo].lng).toBeDefined()
      })
    })

    it('should have at least 23 DO colo entries', () => {
      expect(Object.keys(COLO_COORDINATES).length).toBeGreaterThanOrEqual(23)
    })
  })

  describe('coordinate validity', () => {
    it('should have valid latitude range (-90 to 90)', () => {
      Object.entries(COLO_COORDINATES).forEach(([colo, coords]) => {
        expect(coords.lat).toBeGreaterThanOrEqual(-90)
        expect(coords.lat).toBeLessThanOrEqual(90)
      })
    })

    it('should have valid longitude range (-180 to 180)', () => {
      Object.entries(COLO_COORDINATES).forEach(([colo, coords]) => {
        expect(coords.lng).toBeGreaterThanOrEqual(-180)
        expect(coords.lng).toBeLessThanOrEqual(180)
      })
    })
  })

  describe('specific colo coordinates', () => {
    it('should have LAX coordinates near Los Angeles', () => {
      const lax = COLO_COORDINATES.lax
      expect(lax.lat).toBeCloseTo(33.94, 0)
      expect(lax.lng).toBeCloseTo(-118.4, 0)
    })

    it('should have IAD coordinates near Washington DC', () => {
      const iad = COLO_COORDINATES.iad
      expect(iad.lat).toBeCloseTo(38.94, 0)
      expect(iad.lng).toBeCloseTo(-77.5, 0)
    })

    it('should have LHR coordinates near London', () => {
      const lhr = COLO_COORDINATES.lhr
      expect(lhr.lat).toBeCloseTo(51.5, 0)
      expect(lhr.lng).toBeCloseTo(-0.5, 0)
    })

    it('should have SIN coordinates near Singapore', () => {
      const sin = COLO_COORDINATES.sin
      expect(sin.lat).toBeCloseTo(1.4, 0)
      expect(sin.lng).toBeCloseTo(104, 0)
    })

    it('should have NRT coordinates near Tokyo', () => {
      const nrt = COLO_COORDINATES.nrt
      expect(nrt.lat).toBeCloseTo(35.8, 0)
      expect(nrt.lng).toBeCloseTo(140, 0)
    })
  })

  describe('type compatibility', () => {
    it('should match ColoCode type', () => {
      const coloCode: ColoCode = 'lax'
      const coords = COLO_COORDINATES[coloCode]

      expect(coords).toBeDefined()
      expect(coords.lat).toBeDefined()
      expect(coords.lng).toBeDefined()
    })

    it('should allow iteration over all colos', () => {
      const coloCodes = Object.keys(COLO_COORDINATES) as ColoCode[]

      expect(coloCodes.length).toBeGreaterThan(0)
      coloCodes.forEach((code) => {
        expect(typeof code).toBe('string')
      })
    })
  })
})

// ============================================================================
// GlobeArc Interface and createConnectionArc Tests
// ============================================================================

describe('GlobeArc Interface', () => {
  describe('required properties', () => {
    it('should have startLat property', () => {
      const arc: GlobeArc = {
        startLat: 33.9425,
        startLng: -118.408,
        endLat: 38.9445,
        endLng: -77.4558,
      }

      expect(arc.startLat).toBe(33.9425)
    })

    it('should have startLng property', () => {
      const arc: GlobeArc = {
        startLat: 33.9425,
        startLng: -118.408,
        endLat: 38.9445,
        endLng: -77.4558,
      }

      expect(arc.startLng).toBe(-118.408)
    })

    it('should have endLat property', () => {
      const arc: GlobeArc = {
        startLat: 33.9425,
        startLng: -118.408,
        endLat: 38.9445,
        endLng: -77.4558,
      }

      expect(arc.endLat).toBe(38.9445)
    })

    it('should have endLng property', () => {
      const arc: GlobeArc = {
        startLat: 33.9425,
        startLng: -118.408,
        endLat: 38.9445,
        endLng: -77.4558,
      }

      expect(arc.endLng).toBe(-77.4558)
    })
  })

  describe('optional properties', () => {
    it('should allow optional color', () => {
      const arcWithColor: GlobeArc = {
        startLat: 33.9425,
        startLng: -118.408,
        endLat: 38.9445,
        endLng: -77.4558,
        color: '#00ff00',
      }

      const arcWithoutColor: GlobeArc = {
        startLat: 33.9425,
        startLng: -118.408,
        endLat: 38.9445,
        endLng: -77.4558,
      }

      expect(arcWithColor.color).toBe('#00ff00')
      expect(arcWithoutColor.color).toBeUndefined()
    })
  })
})

describe('createConnectionArc', () => {
  describe('basic arc creation', () => {
    it('should create arc between two colos', () => {
      const arc = createConnectionArc('lax', 'iad')

      expect(arc).toBeDefined()
      expect(arc.startLat).toBeDefined()
      expect(arc.startLng).toBeDefined()
      expect(arc.endLat).toBeDefined()
      expect(arc.endLng).toBeDefined()
    })

    it('should use colo coordinates for start', () => {
      const arc = createConnectionArc('lax', 'iad')

      expect(arc.startLat).toBeCloseTo(33.94, 0)
      expect(arc.startLng).toBeCloseTo(-118.4, 0)
    })

    it('should use colo coordinates for end', () => {
      const arc = createConnectionArc('lax', 'iad')

      expect(arc.endLat).toBeCloseTo(38.94, 0)
      expect(arc.endLng).toBeCloseTo(-77.5, 0)
    })
  })

  describe('different colo pairs', () => {
    it('should create arc from LAX to LHR', () => {
      const arc = createConnectionArc('lax', 'lhr')

      expect(arc.startLat).toBeCloseTo(33.94, 0) // LAX
      expect(arc.endLat).toBeCloseTo(51.5, 0) // LHR
    })

    it('should create arc from IAD to SIN', () => {
      const arc = createConnectionArc('iad', 'sin')

      expect(arc.startLat).toBeCloseTo(38.94, 0) // IAD
      expect(arc.endLat).toBeCloseTo(1.4, 0) // SIN
    })

    it('should create arc from LHR to NRT', () => {
      const arc = createConnectionArc('lhr', 'nrt')

      expect(arc.startLat).toBeCloseTo(51.5, 0) // LHR
      expect(arc.endLat).toBeCloseTo(35.8, 0) // NRT
    })
  })

  describe('custom color support', () => {
    it('should support custom colors', () => {
      const arc = createConnectionArc('lax', 'iad', { color: '#ff0000' })

      expect(arc.color).toBe('#ff0000')
    })

    it('should work without color option', () => {
      const arc = createConnectionArc('lax', 'iad')

      expect(arc.color).toBeUndefined()
    })
  })

  describe('return type', () => {
    it('should return GlobeArc type', () => {
      const arc: GlobeArc = createConnectionArc('lax', 'iad')

      expect(typeof arc.startLat).toBe('number')
      expect(typeof arc.startLng).toBe('number')
      expect(typeof arc.endLat).toBe('number')
      expect(typeof arc.endLng).toBe('number')
    })
  })

  describe('bidirectional arcs', () => {
    it('should create reversed arc when colos are swapped', () => {
      const arcLaxToIad = createConnectionArc('lax', 'iad')
      const arcIadToLax = createConnectionArc('iad', 'lax')

      expect(arcLaxToIad.startLat).toBeCloseTo(arcIadToLax.endLat, 2)
      expect(arcLaxToIad.startLng).toBeCloseTo(arcIadToLax.endLng, 2)
      expect(arcLaxToIad.endLat).toBeCloseTo(arcIadToLax.startLat, 2)
      expect(arcLaxToIad.endLng).toBeCloseTo(arcIadToLax.startLng, 2)
    })
  })
})

// ============================================================================
// ColoDataClient Interface Tests
// ============================================================================

describe('ColoDataClient Interface', () => {
  it('should define getAllColos method', async () => {
    const client: ColoDataClient = new MockColoDataClient([sampleColoMetadata])

    const colos = await client.getAllColos()

    expect(colos).toBeInstanceOf(Array)
    expect(colos[0]).toEqual(sampleColoMetadata)
  })

  it('should define getDoSupportedColos method', async () => {
    const client: ColoDataClient = new MockColoDataClient([
      sampleColoMetadata,
      nonDoColoMetadata,
    ])

    const colos = await client.getDoSupportedColos()

    expect(colos.length).toBe(1)
    expect(colos[0].supportsDOs).toBe(true)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Globe Data Integration', () => {
  describe('end-to-end marker generation', () => {
    it('should generate markers from client and convert to globe format', async () => {
      const client = new MockColoDataClient([
        sampleColoMetadata,
        iadColoMetadata,
      ])

      const markers = await getAllGlobeMarkers(client)

      expect(markers.length).toBe(2)
      markers.forEach((marker) => {
        expect(marker.location.length).toBe(2)
        expect(marker.size).toBeGreaterThan(0)
        expect(marker.metadata?.colo).toBeDefined()
      })
    })

    it('should support COBE library marker format', async () => {
      const client = new MockColoDataClient([sampleColoMetadata])

      const markers = await getAllGlobeMarkers(client)

      // COBE expects markers as { location: [lat, lng], size: number }
      const cobeMarker = markers[0]
      expect(cobeMarker.location).toBeInstanceOf(Array)
      expect(cobeMarker.location[0]).toBe(33.9425) // lat
      expect(cobeMarker.location[1]).toBe(-118.408) // lng
      expect(typeof cobeMarker.size).toBe('number')
    })
  })

  describe('distribution visualization', () => {
    it('should visualize DO distribution with scaled markers', () => {
      const distributions: DODistribution[] = [
        { colo: 'lax', count: 100, lastActive: new Date() },
        { colo: 'iad', count: 500, lastActive: new Date() },
        { colo: 'lhr', count: 250, lastActive: new Date() },
      ]

      const metadataMap = new Map<ColoCode, ColoMetadata>([
        ['lax', sampleColoMetadata],
        ['iad', iadColoMetadata],
        ['lhr', lhrColoMetadata],
      ])

      const markers = distributionToMarkers(distributions, metadataMap)

      // Verify size scaling
      const lax = markers.find((m) => m.metadata?.colo === 'lax')!
      const iad = markers.find((m) => m.metadata?.colo === 'iad')!
      const lhr = markers.find((m) => m.metadata?.colo === 'lhr')!

      expect(iad.size).toBeGreaterThan(lhr.size)
      expect(lhr.size).toBeGreaterThan(lax.size)

      // Verify counts in metadata
      expect(lax.metadata?.doCount).toBe(100)
      expect(iad.metadata?.doCount).toBe(500)
      expect(lhr.metadata?.doCount).toBe(250)
    })
  })

  describe('connection arc visualization', () => {
    it('should create arcs for multi-region connections', () => {
      const connections: Array<[ColoCode, ColoCode]> = [
        ['lax', 'iad'],
        ['iad', 'lhr'],
        ['lhr', 'sin'],
      ]

      const arcs = connections.map(([from, to]) => createConnectionArc(from, to))

      expect(arcs.length).toBe(3)
      arcs.forEach((arc) => {
        expect(arc.startLat).toBeDefined()
        expect(arc.startLng).toBeDefined()
        expect(arc.endLat).toBeDefined()
        expect(arc.endLng).toBeDefined()
      })
    })
  })
})

// ============================================================================
// Type Export Tests
// ============================================================================

describe('Type Exports', () => {
  it('exports coloToGlobeMarker function', () => {
    expect(typeof coloToGlobeMarker).toBe('function')
  })

  it('exports getAllGlobeMarkers function', () => {
    expect(typeof getAllGlobeMarkers).toBe('function')
  })

  it('exports distributionToMarkers function', () => {
    expect(typeof distributionToMarkers).toBe('function')
  })

  it('exports createConnectionArc function', () => {
    expect(typeof createConnectionArc).toBe('function')
  })

  it('exports COLO_COORDINATES constant', () => {
    expect(COLO_COORDINATES).toBeDefined()
    expect(typeof COLO_COORDINATES).toBe('object')
  })
})
