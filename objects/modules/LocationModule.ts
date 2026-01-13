/**
 * LocationModule - Extracted location detection and caching from DOBase
 *
 * This module handles:
 * - Location detection via Cloudflare's trace endpoint
 * - In-memory and persistent storage caching
 * - Coordinate extraction from CF request headers
 * - Lifecycle hook for location detection events
 *
 * Extracted from DOBase to separate location concerns from the main DO logic.
 * Part of Phase 1 decomposition (low-risk extractions).
 */

import type { DOLocation, ColoCode, ColoCity, Region, CFLocationHint } from '../../types/Location'
import { codeToCity, coloRegion, regionToCF } from '../../types/Location'
import { LOCATION_STORAGE_KEY } from '../../lib/colo/caching'

/**
 * Stored location format (supports legacy and new coordinate formats)
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
    // Legacy format support
    latitude?: number
    longitude?: number
  }
}

/**
 * Storage interface for DO storage operations
 */
export interface LocationStorage {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: unknown): Promise<void>
}

/**
 * Lifecycle hook type for location detection callback
 */
export type LocationDetectedHook = (location: DOLocation) => Promise<void>

/**
 * LocationModule - Manages DO location detection and caching
 */
export class LocationModule {
  /** Cached location instance (in-memory) */
  private _cachedLocation?: DOLocation

  /** Flag to track if location hook was already called */
  private _locationHookCalled = false

  /** Coordinates extracted from CF request headers */
  private _extractedCoordinates?: { lat: number; lng: number }

  /** Storage interface for persistence */
  private readonly _storage: LocationStorage

  /** Optional lifecycle hook callback */
  private _onLocationDetected?: LocationDetectedHook

  constructor(storage: LocationStorage, onLocationDetected?: LocationDetectedHook) {
    this._storage = storage
    this._onLocationDetected = onLocationDetected
  }

  /**
   * Set the location detected lifecycle hook.
   * Called once when location is first detected.
   */
  setOnLocationDetected(hook: LocationDetectedHook): void {
    this._onLocationDetected = hook
  }

  /**
   * Extract coordinates from Cloudflare request headers.
   * Call this during request handling to capture geo data.
   *
   * @param request - The incoming HTTP request with CF headers
   */
  extractCoordinatesFromRequest(request: Request): void {
    // Extract from CF-* headers if available
    const lat = request.headers.get('cf-iplatitude')
    const lng = request.headers.get('cf-iplongitude')

    if (lat && lng) {
      const parsedLat = parseFloat(lat)
      const parsedLng = parseFloat(lng)

      if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
        this._extractedCoordinates = { lat: parsedLat, lng: parsedLng }
      }
    }
  }

  /**
   * Get the DO's location (with caching).
   *
   * On first call, detects location via Cloudflare's trace endpoint,
   * caches it in storage, and calls the onLocationDetected hook.
   * Subsequent calls return the cached location immediately.
   *
   * @returns Promise resolving to the DO's location
   */
  async getLocation(): Promise<DOLocation> {
    // Return cached location if available
    if (this._cachedLocation) {
      return this._cachedLocation
    }

    // Check DO storage for persisted location
    const cached = await this._storage.get<StoredLocation>(LOCATION_STORAGE_KEY)

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
          cached.detectedAt instanceof Date
            ? cached.detectedAt
            : new Date(cached.detectedAt),
        coordinates: coords,
      }) as DOLocation

      return this._cachedLocation
    }

    // Detect fresh location
    const location = await this._detectLocation()

    // Cache in memory (frozen for immutability)
    this._cachedLocation = Object.freeze(location) as DOLocation

    // Persist to storage
    await this._storage.put(LOCATION_STORAGE_KEY, {
      colo: location.colo,
      city: location.city,
      region: location.region,
      cfHint: location.cfHint,
      detectedAt: location.detectedAt.toISOString(),
      coordinates: location.coordinates,
    })

    // Call lifecycle hook (only once)
    if (!this._locationHookCalled && this._onLocationDetected) {
      this._locationHookCalled = true
      try {
        await this._onLocationDetected(this._cachedLocation)
      } catch (error) {
        // Log but don't propagate hook errors
        console.error('Error in onLocationDetected hook:', error)
      }
    }

    return this._cachedLocation
  }

  /**
   * Internal method to detect location from Cloudflare's trace endpoint.
   * Can be overridden in tests to provide mock location data.
   *
   * @returns Promise resolving to detected DOLocation
   */
  async _detectLocation(): Promise<DOLocation> {
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
      console.error('Failed to detect location:', error)
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

  /**
   * Clear cached location (for testing or forced refresh)
   */
  clearCache(): void {
    this._cachedLocation = undefined
    this._locationHookCalled = false
    this._extractedCoordinates = undefined
  }

  /**
   * Check if location has been cached
   */
  get hasCachedLocation(): boolean {
    return this._cachedLocation !== undefined
  }

  /**
   * Get current extracted coordinates (if any)
   */
  get extractedCoordinates(): { lat: number; lng: number } | undefined {
    return this._extractedCoordinates
  }
}
