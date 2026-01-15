/**
 * @module LocationManager
 * @description Location detection and caching for Durable Objects
 *
 * Handles:
 * - Cloudflare colo detection via trace endpoint
 * - Location caching in DO storage
 * - Coordinate extraction from CF request headers
 * - Lifecycle hooks for location detection
 *
 * Extracted from DOBase.ts for better modularity.
 */

import type { DOLocation } from '../../types/Location'
import type { ColoCode, ColoCity, Region, CFLocationHint } from '../../types/Location'
import { codeToCity, coloRegion, regionToCF } from '../../types/Location'
import { LOCATION_STORAGE_KEY } from '../../lib/colo/caching'
import { logBestEffortError } from '@/lib/logging/error-logger'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Callback for when location is first detected
 */
export type LocationDetectedCallback = (location: DOLocation) => Promise<void>

/**
 * Dependencies required by LocationManager
 */
export interface LocationManagerDeps {
  /** DurableObject context for storage access */
  ctx: DurableObjectState

  /** Optional callback when location is detected */
  onLocationDetected?: LocationDetectedCallback
}

/**
 * Cached location format in storage (may have legacy coordinate format)
 */
interface StoredLocation {
  colo: string
  city: string
  region: string
  cfHint: string
  detectedAt: string | Date
  coordinates?: {
    lat?: number
    lng?: number
    latitude?: number
    longitude?: number
  }
}

// ============================================================================
// LOCATION MANAGER CLASS
// ============================================================================

/**
 * LocationManager - Manages location detection and caching for DOs
 *
 * This class encapsulates all location-related logic, allowing it to be
 * composed into DO classes rather than inherited.
 *
 * @example
 * ```typescript
 * class MyDO extends DOBase {
 *   private location = new LocationManager({
 *     ctx: this.ctx,
 *     onLocationDetected: async (loc) => {
 *       console.log('DO running in', loc.city)
 *     },
 *   })
 *
 *   async handleRequest(request: Request) {
 *     this.location.extractCoordinatesFromRequest(request)
 *     const location = await this.location.get()
 *   }
 * }
 * ```
 */
export class LocationManager {
  private readonly deps: LocationManagerDeps

  /** Cached location (in-memory) */
  private _cachedLocation?: DOLocation

  /** Flag to track if location hook was already called */
  private _locationHookCalled: boolean = false

  /** Coordinates extracted from CF request headers */
  private _extractedCoordinates?: { lat: number; lng: number }

  constructor(deps: LocationManagerDeps) {
    this.deps = deps
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the DO's location (with caching).
   *
   * On first call, detects location via Cloudflare's trace endpoint,
   * caches it in storage, and calls the onLocationDetected callback.
   * Subsequent calls return the cached location immediately.
   *
   * @returns Promise resolving to the DO's location
   */
  async get(): Promise<DOLocation> {
    // Return cached location if available
    if (this._cachedLocation) {
      return this._cachedLocation
    }

    // Check DO storage for persisted location
    const cached = await this.deps.ctx.storage.get<StoredLocation>(LOCATION_STORAGE_KEY)

    if (cached) {
      // Restore from storage, converting coordinates to canonical format if needed
      const coords = cached.coordinates
        ? {
            lat: cached.coordinates.lat ?? cached.coordinates.latitude ?? 0,
            lng: cached.coordinates.lng ?? cached.coordinates.longitude ?? 0,
          }
        : undefined

      this._cachedLocation = Object.freeze({
        colo: cached.colo as ColoCode,
        city: cached.city as ColoCity,
        region: cached.region as Region,
        cfHint: cached.cfHint as CFLocationHint,
        detectedAt:
          cached.detectedAt instanceof Date ? cached.detectedAt : new Date(cached.detectedAt),
        coordinates: coords,
      }) as DOLocation

      return this._cachedLocation
    }

    // Detect fresh location
    const location = await this.detect()

    // Cache in memory (frozen for immutability)
    this._cachedLocation = Object.freeze(location) as DOLocation

    // Persist to storage
    await this.deps.ctx.storage.put(LOCATION_STORAGE_KEY, {
      colo: location.colo,
      city: location.city,
      region: location.region,
      cfHint: location.cfHint,
      detectedAt: location.detectedAt.toISOString(),
      coordinates: location.coordinates,
    })

    // Call lifecycle callback (only once)
    if (!this._locationHookCalled && this.deps.onLocationDetected) {
      this._locationHookCalled = true
      try {
        await this.deps.onLocationDetected(this._cachedLocation)
      } catch (error) {
        // Log but don't propagate callback errors
        logBestEffortError(error, {
          operation: 'onLocationDetected',
          source: 'LocationManager.get',
        })
      }
    }

    return this._cachedLocation
  }

  /**
   * Extract coordinates from Cloudflare request headers.
   * Call this before get() to include coordinates in the location.
   *
   * @param request - The incoming request with CF headers
   */
  extractCoordinatesFromRequest(request: Request): void {
    const lat = request.headers.get('cf-iplatitude')
    const lng = request.headers.get('cf-iplongitude')

    if (lat && lng) {
      const latNum = parseFloat(lat)
      const lngNum = parseFloat(lng)

      if (!isNaN(latNum) && !isNaN(lngNum)) {
        this._extractedCoordinates = { lat: latNum, lng: lngNum }
      }
    }
  }

  /**
   * Clear the cached location (for testing or forced refresh).
   */
  clearCache(): void {
    this._cachedLocation = undefined
    this._locationHookCalled = false
  }

  /**
   * Check if location has been cached.
   */
  get isCached(): boolean {
    return this._cachedLocation !== undefined
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Detect location from Cloudflare's trace endpoint.
   * Override in tests to provide mock location data.
   *
   * @returns Promise resolving to detected DOLocation
   */
  async detect(): Promise<DOLocation> {
    try {
      // Fetch from Cloudflare's trace endpoint
      const response = await fetch('https://cloudflare.com/cdn-cgi/trace')
      if (!response.ok) {
        throw new Error(`Trace endpoint returned ${response.status}`)
      }

      const text = await response.text()
      const lines = text.split('\n')
      const data: Record<string, string> = {}

      for (const line of lines) {
        const [key, value] = line.split('=')
        if (key && value) {
          data[key.trim()] = value.trim()
        }
      }

      const coloCode = (data.colo || 'lax').toLowerCase() as ColoCode
      const city = (codeToCity[coloCode as keyof typeof codeToCity] || 'LosAngeles') as ColoCity
      const region = (coloRegion[coloCode as keyof typeof coloRegion] || 'us-west') as Region
      const cfHint = (regionToCF[region as keyof typeof regionToCF] || 'wnam') as CFLocationHint

      const location: DOLocation = {
        colo: coloCode,
        city,
        region,
        cfHint,
        detectedAt: new Date(),
      }

      // Add coordinates if extracted from request
      if (this._extractedCoordinates) {
        location.coordinates = this._extractedCoordinates
      }

      return location
    } catch (error) {
      // Fallback to default location on error
      logBestEffortError(error, {
        operation: 'detectLocation',
        source: 'LocationManager.detectLocation',
      })
      const location: DOLocation = {
        colo: 'lax',
        city: 'LosAngeles',
        region: 'us-west',
        cfHint: 'wnam',
        detectedAt: new Date(),
      }
      if (this._extractedCoordinates) {
        location.coordinates = this._extractedCoordinates
      }
      return location
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a LocationManager instance
 */
export function createLocationManager(deps: LocationManagerDeps): LocationManager {
  return new LocationManager(deps)
}
