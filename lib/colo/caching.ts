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
import { codeToCity, coloRegion, regionToCF } from '../../types/Location'
import { fetchDOLocation } from './detection'

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
// DOLocation Type
// ============================================================================

/**
 * Represents the detected location of a Durable Object instance
 */
export interface DOLocation {
  /** IATA code for the Cloudflare colo (e.g., 'lax', 'iad') */
  colo: ColoCode
  /** Geographic region (e.g., 'us-west', 'us-east') */
  region: Region
  /** City name (e.g., 'LosAngeles', 'Virginia') */
  city: ColoCity
  /** Cloudflare location hint (e.g., 'wnam', 'enam') */
  cfHint: CFLocationHint
  /** Timestamp when location was detected */
  detectedAt: Date
}

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
  detectedAt: string | Date
}

/**
 * Serialize DOLocation for storage
 */
function serializeDOLocation(location: DOLocation): SerializedDOLocation {
  return {
    colo: location.colo,
    region: location.region,
    city: location.city,
    cfHint: location.cfHint,
    detectedAt: location.detectedAt instanceof Date
      ? location.detectedAt.toISOString()
      : location.detectedAt,
  }
}

/**
 * Deserialize DOLocation from storage
 */
function deserializeDOLocation(serialized: SerializedDOLocation): DOLocation {
  return {
    colo: serialized.colo,
    region: serialized.region,
    city: serialized.city,
    cfHint: serialized.cfHint,
    detectedAt: serialized.detectedAt instanceof Date
      ? serialized.detectedAt
      : new Date(serialized.detectedAt),
  }
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

  // Detect location (returns detection module's DOLocation format)
  const detected = await fetchDOLocation()

  // Convert to caching module's DOLocation format
  const colo = detected.colo
  const city = codeToCity[colo]
  const region = coloRegion[colo]
  const cfHint = regionToCF[region]

  const location: DOLocation = {
    colo,
    city,
    region,
    cfHint,
    detectedAt: detected.detectedAt,
  }

  // Cache the result
  await cache.set(location)

  return location
}
