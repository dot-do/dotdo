/**
 * DO Location Caching
 *
 * Issue: dotdo-4cgch - DO location caching
 *
 * Once a DO detects its location, it should cache it in DO storage since
 * the location never changes for a given DO instance.
 *
 * This module provides:
 * - LocationCache class for managing cached DO location
 * - getOrDetectLocation() function for cached location retrieval
 * - Storage key constants for consistent access
 */

import type { ColoCode, ColoCity, Region, CFLocationHint } from '../../types/Location'
import { type DOLocation, type CfJsonData, type TraceData } from '../../types/DOLocation'
import { fetchDOLocation } from './detection'

// Re-export canonical DOLocation type
export type { DOLocation }

// ============================================================================
// Storage Key Constants
// ============================================================================

/**
 * Storage key used for caching DO location
 */
export const LOCATION_STORAGE_KEY = 'do:location'

/**
 * Cache version for migration support
 */
export const LOCATION_CACHE_VERSION = 1

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Serialized format for DOLocation (Date stored as ISO string)
 */
interface SerializedDOLocation {
  colo: ColoCode
  region: Region
  city: ColoCity
  cfHint: CFLocationHint
  detectedAt: string
  coordinates?: { lat: number; lng: number }
  cf?: CfJsonData
  trace?: TraceData
  ip?: string
  country?: string
  timezone?: string
}

/**
 * Serialize DOLocation for storage
 */
function serializeDOLocation(location: DOLocation): SerializedDOLocation {
  const serialized: SerializedDOLocation = {
    colo: location.colo,
    region: location.region,
    city: location.city,
    cfHint: location.cfHint,
    detectedAt: location.detectedAt instanceof Date
      ? location.detectedAt.toISOString()
      : new Date(location.detectedAt).toISOString(),
  }

  if (location.coordinates) serialized.coordinates = location.coordinates
  if (location.cf) serialized.cf = location.cf
  if (location.trace) serialized.trace = location.trace
  if (location.ip) serialized.ip = location.ip
  if (location.country) serialized.country = location.country
  if (location.timezone) serialized.timezone = location.timezone

  return serialized
}

/**
 * Deserialize DOLocation from storage
 */
function deserializeDOLocation(serialized: SerializedDOLocation): DOLocation {
  const location: DOLocation = {
    colo: serialized.colo,
    region: serialized.region,
    city: serialized.city,
    cfHint: serialized.cfHint,
    detectedAt: new Date(serialized.detectedAt),
  }

  if (serialized.coordinates) location.coordinates = serialized.coordinates
  if (serialized.cf) location.cf = serialized.cf
  if (serialized.trace) location.trace = serialized.trace
  if (serialized.ip) location.ip = serialized.ip
  if (serialized.country) location.country = serialized.country
  if (serialized.timezone) location.timezone = serialized.timezone

  return location
}

// ============================================================================
// LocationCache Class
// ============================================================================

/**
 * Cache for storing and retrieving DO location from DurableObjectStorage
 *
 * Once a DO detects its location, it's immutable for the lifetime of that
 * DO instance. This cache ensures we only detect once and persist the result.
 *
 * @example
 * ```typescript
 * const cache = new LocationCache(ctx.storage)
 *
 * // Check if location is cached
 * if (await cache.has()) {
 *   const location = await cache.get()
 *   console.log(`DO located at: ${location.city}`)
 * }
 *
 * // Cache detected location
 * await cache.set(detectedLocation)
 * ```
 */
export class LocationCache {
  private storage: DurableObjectStorage

  constructor(storage: DurableObjectStorage) {
    this.storage = storage
  }

  /**
   * Get cached location or null if not cached
   *
   * @returns The cached DOLocation or null
   */
  async get(): Promise<DOLocation | null> {
    const cached = await this.storage.get<SerializedDOLocation>(LOCATION_STORAGE_KEY)
    if (!cached) {
      return null
    }
    return deserializeDOLocation(cached)
  }

  /**
   * Set cached location (returns the location)
   *
   * If a location is already cached, this is a no-op and returns
   * the existing cached location (immutable per DO instance).
   *
   * @param location - The location to cache
   * @returns The cached location (may be existing if already set)
   */
  async set(location: DOLocation): Promise<DOLocation> {
    // Check if already cached - don't overwrite
    const existing = await this.get()
    if (existing) {
      return existing
    }
    // Store serialized location
    await this.storage.put(LOCATION_STORAGE_KEY, serializeDOLocation(location))
    return location
  }

  /**
   * Check if location is cached
   *
   * @returns True if location is cached, false otherwise
   */
  async has(): Promise<boolean> {
    const cached = await this.storage.get(LOCATION_STORAGE_KEY)
    return cached !== undefined
  }

  /**
   * Clear cached location (primarily for testing)
   *
   * In production, this should rarely be called since DO location
   * is immutable once detected.
   */
  async clear(): Promise<void> {
    await this.storage.delete(LOCATION_STORAGE_KEY)
  }
}

// ============================================================================
// getOrDetectLocation Function
// ============================================================================

/**
 * Gets cached location or detects and caches it
 *
 * This function should be the primary way to get a DO's location:
 * 1. Check if location is cached in storage
 * 2. If cached, return it immediately
 * 3. If not cached, detect location and cache it
 * 4. Return the location
 *
 * Detection only happens once per DO lifetime.
 *
 * @param storage - DurableObjectStorage for caching
 * @returns The DO's location (cached or freshly detected)
 *
 * @example
 * ```typescript
 * // In a Durable Object
 * async fetch(request: Request) {
 *   const location = await getOrDetectLocation(this.ctx.storage)
 *   console.log(`Processing request at ${location.city} (${location.colo})`)
 *   // ...
 * }
 * ```
 */
export async function getOrDetectLocation(
  storage: DurableObjectStorage
): Promise<DOLocation> {
  const cache = new LocationCache(storage)

  // Check cache first
  const cached = await cache.get()
  if (cached) {
    return cached
  }

  // Detect location (returns canonical DOLocation with all fields populated)
  const location = await fetchDOLocation()

  // Cache the result
  await cache.set(location)

  return location
}
