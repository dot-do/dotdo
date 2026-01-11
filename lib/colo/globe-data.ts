/**
 * Globe Visualization Coordinate Data
 *
 * Issue: dotdo-q7o58 - Export colo coordinates for @mdxui/globe package
 *
 * Provides data structures and functions for visualizing DO (Durable Object)
 * distribution on a 3D globe using the COBE library.
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

import type {
  Region,
  ColoCode,
  ColoCity,
} from '../../types/Location'

import type { ColoMetadata } from '../../types/DOLocation'

// ============================================================================
// Types
// ============================================================================

/**
 * Marker data for COBE globe visualization
 *
 * Location is a [lat, lng] tuple as required by COBE library.
 * Size controls the marker radius (0.01-0.1 typical range).
 */
export interface GlobeMarker {
  /** [lat, lng] coordinates for COBE */
  location: [number, number]
  /** Marker size (0.01-0.1 typical) */
  size: number
  /** Optional label for the marker */
  label?: string
  /** Optional color (hex string) */
  color?: string
  /** Optional metadata with colo info */
  metadata?: {
    colo: ColoCode
    city: ColoCity
    region: Region
    /** Number of DOs at this colo */
    doCount?: number
  }
}

/**
 * Arc connection between two colos for globe visualization
 */
export interface GlobeArc {
  /** Starting latitude */
  startLat: number
  /** Starting longitude */
  startLng: number
  /** Ending latitude */
  endLat: number
  /** Ending longitude */
  endLng: number
  /** Optional color (hex string) */
  color?: string
}

/**
 * DO distribution data for real-time visualization
 */
export interface DODistribution {
  /** Colo code where DOs are running */
  colo: ColoCode
  /** Number of DOs at this colo */
  count: number
  /** When the distribution was last updated */
  lastActive: Date
}

/**
 * Client interface for fetching colo data
 */
export interface ColoDataClient {
  /** Get all colo metadata */
  getAllColos(): Promise<ColoMetadata[]>
  /** Get only DO-supporting colos */
  getDoSupportedColos(): Promise<ColoMetadata[]>
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Static coordinates for all known DO colos
 *
 * Coordinates are based on airport/datacenter locations.
 * Format: { lat: number, lng: number }
 */
export const COLO_COORDINATES: Record<ColoCode, { lat: number; lng: number }> = {
  // US West
  lax: { lat: 33.9425, lng: -118.408 },
  sjc: { lat: 37.3639, lng: -121.929 },
  sea: { lat: 47.4502, lng: -122.309 },
  den: { lat: 39.8561, lng: -104.674 },
  // US East
  iad: { lat: 38.9445, lng: -77.4558 },
  ewr: { lat: 40.6895, lng: -74.1745 },
  ord: { lat: 41.9742, lng: -87.9073 },
  dfw: { lat: 32.8998, lng: -97.0403 },
  atl: { lat: 33.6407, lng: -84.4277 },
  mia: { lat: 25.7959, lng: -80.2870 },
  // EU West
  lhr: { lat: 51.4700, lng: -0.4543 },
  cdg: { lat: 49.0097, lng: 2.5479 },
  ams: { lat: 52.3105, lng: 4.7683 },
  fra: { lat: 50.0379, lng: 8.5622 },
  mrs: { lat: 43.4367, lng: 5.2151 },
  mxp: { lat: 45.6306, lng: 8.7281 },
  // EU East
  prg: { lat: 50.1008, lng: 14.2600 },
  arn: { lat: 59.6519, lng: 17.9186 },
  vie: { lat: 48.1103, lng: 16.5697 },
  // Asia-Pacific
  sin: { lat: 1.3644, lng: 103.9915 },
  hkg: { lat: 22.3080, lng: 113.9185 },
  nrt: { lat: 35.7720, lng: 140.3929 },
  kix: { lat: 34.4347, lng: 135.2441 },
}

// ============================================================================
// Functions
// ============================================================================

/**
 * Options for converting ColoMetadata to GlobeMarker
 */
export interface ColoToGlobeMarkerOptions {
  /** Custom marker size (default ~0.05) */
  size?: number
  /** Custom color (hex string) */
  color?: string
  /** Include label (colo code uppercase) */
  includeLabel?: boolean
}

/**
 * Convert ColoMetadata to GlobeMarker
 *
 * @param coloMetadata - Colo metadata with coordinates
 * @param options - Optional customization options
 * @returns GlobeMarker for COBE globe
 *
 * @example
 * ```ts
 * const marker = coloToGlobeMarker(coloMetadata)
 * // { location: [33.9425, -118.408], size: 0.05, metadata: { colo: 'lax', ... } }
 * ```
 */
export function coloToGlobeMarker(
  coloMetadata: ColoMetadata,
  options?: ColoToGlobeMarkerOptions
): GlobeMarker {
  const marker: GlobeMarker = {
    location: [coloMetadata.coordinates.lat, coloMetadata.coordinates.lng],
    size: options?.size ?? 0.03,
    metadata: {
      colo: coloMetadata.code,
      city: coloMetadata.city,
      region: coloMetadata.region,
    },
  }

  if (options?.color) {
    marker.color = options.color
  }

  if (options?.includeLabel) {
    marker.label = coloMetadata.code.toUpperCase()
  }

  return marker
}

/**
 * Options for getAllGlobeMarkers
 */
export interface GetAllGlobeMarkersOptions {
  /** Only include DO-supporting colos */
  doColsOnly?: boolean
}

/**
 * Get globe markers for all colos
 *
 * @param client - ColoDataClient for fetching colo data
 * @param options - Optional filtering options
 * @returns Promise resolving to array of GlobeMarkers
 *
 * @example
 * ```ts
 * const markers = await getAllGlobeMarkers(client, { doColsOnly: true })
 * // Returns markers for all DO-supporting colos
 * ```
 */
export async function getAllGlobeMarkers(
  client: ColoDataClient,
  options?: GetAllGlobeMarkersOptions
): Promise<GlobeMarker[]> {
  const colos = options?.doColsOnly
    ? await client.getDoSupportedColos()
    : await client.getAllColos()

  return colos.map((colo) => coloToGlobeMarker(colo))
}

/**
 * Convert DO distribution data to sized globe markers
 *
 * Markers are sized based on DO count - more DOs = larger marker.
 *
 * @param distributions - Array of DO distribution data
 * @param coloMetadata - Map of colo codes to metadata
 * @returns Array of sized GlobeMarkers
 *
 * @example
 * ```ts
 * const markers = distributionToMarkers(distributions, metadataMap)
 * // Markers sized by DO count at each colo
 * ```
 */
export function distributionToMarkers(
  distributions: DODistribution[],
  coloMetadata: Map<ColoCode, ColoMetadata>
): GlobeMarker[] {
  // Filter to only distributions with known colos
  const validDistributions = distributions.filter((d) => coloMetadata.has(d.colo))

  if (validDistributions.length === 0) {
    return []
  }

  // Find max count for scaling
  const maxCount = Math.max(...validDistributions.map((d) => d.count))

  // Size range: 0.01 (min) to 0.1 (max)
  const minSize = 0.01
  const maxSize = 0.1

  return validDistributions.map((dist) => {
    const metadata = coloMetadata.get(dist.colo)!

    // Scale size based on count relative to max
    // Use log scale to prevent extreme differences
    const scaleFactor = maxCount > 1 ? Math.log(dist.count + 1) / Math.log(maxCount + 1) : 1
    const size = Math.max(minSize, Math.min(maxSize, minSize + scaleFactor * (maxSize - minSize)))

    return {
      location: [metadata.coordinates.lat, metadata.coordinates.lng] as [number, number],
      size,
      metadata: {
        colo: metadata.code,
        city: metadata.city,
        region: metadata.region,
        doCount: dist.count,
      },
    }
  })
}

/**
 * Options for createConnectionArc
 */
export interface CreateConnectionArcOptions {
  /** Custom arc color (hex string) */
  color?: string
}

/**
 * Create a connection arc between two colos
 *
 * @param fromColo - Source colo code
 * @param toColo - Destination colo code
 * @param options - Optional customization
 * @returns GlobeArc for COBE globe
 *
 * @example
 * ```ts
 * const arc = createConnectionArc('lax', 'iad')
 * // { startLat: 33.94, startLng: -118.4, endLat: 38.94, endLng: -77.5 }
 * ```
 */
export function createConnectionArc(
  fromColo: ColoCode,
  toColo: ColoCode,
  options?: CreateConnectionArcOptions
): GlobeArc {
  const fromCoords = COLO_COORDINATES[fromColo]
  const toCoords = COLO_COORDINATES[toColo]

  const arc: GlobeArc = {
    startLat: fromCoords.lat,
    startLng: fromCoords.lng,
    endLat: toCoords.lat,
    endLng: toCoords.lng,
  }

  if (options?.color) {
    arc.color = options.color
  }

  return arc
}
