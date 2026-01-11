/**
 * External Data Client for WHERE-DOs-Live API
 *
 * Issue: dotdo-2bik1
 *
 * Provides utilities for fetching colo metadata from the WHERE-DOs-Live API
 * until we have enough of our own data. The API provides colo metadata including
 * coordinates and DO support likelihood.
 */

import type { ColoCode, ColoCity, Region } from '../../types/Location'

// ============================================================================
// Types
// ============================================================================

/**
 * Colo metadata from external WHERE-DOs-Live API
 */
export interface ColoMetadata {
  code: ColoCode
  city: ColoCity
  region: Region
  coordinates: { lat: number; lng: number }
  supportsDOs: boolean
  likelihood?: number // 0-1 probability
  latency?: number // Optional latency data
}

/**
 * Result of syncing external data to local storage
 */
export interface SyncResult {
  added: number
  updated: number
  removed: number
  total: number
  syncedAt: Date
}

// ============================================================================
// Static Colo Data (Fallback)
// ============================================================================

/**
 * Static colo data for all 23 DO colos
 * Used as fallback when API is unavailable
 */
const STATIC_COLO_DATA: ColoMetadata[] = [
  // US West
  { code: 'lax', city: 'LosAngeles', region: 'us-west', coordinates: { lat: 33.9425, lng: -118.408 }, supportsDOs: true },
  { code: 'sjc', city: 'SanJose', region: 'us-west', coordinates: { lat: 37.3639, lng: -121.9289 }, supportsDOs: true },
  { code: 'sea', city: 'Seattle', region: 'us-west', coordinates: { lat: 47.4502, lng: -122.3088 }, supportsDOs: true },
  { code: 'den', city: 'Denver', region: 'us-west', coordinates: { lat: 39.8561, lng: -104.6737 }, supportsDOs: true },
  // US East
  { code: 'iad', city: 'Virginia', region: 'us-east', coordinates: { lat: 38.9445, lng: -77.4558 }, supportsDOs: true },
  { code: 'ewr', city: 'Newark', region: 'us-east', coordinates: { lat: 40.6895, lng: -74.1745 }, supportsDOs: true },
  { code: 'ord', city: 'Chicago', region: 'us-east', coordinates: { lat: 41.9742, lng: -87.9073 }, supportsDOs: true },
  { code: 'dfw', city: 'Dallas', region: 'us-east', coordinates: { lat: 32.8998, lng: -97.0403 }, supportsDOs: true },
  { code: 'atl', city: 'Atlanta', region: 'us-east', coordinates: { lat: 33.6407, lng: -84.4277 }, supportsDOs: true },
  { code: 'mia', city: 'Miami', region: 'us-east', coordinates: { lat: 25.7959, lng: -80.2870 }, supportsDOs: true },
  // EU West
  { code: 'lhr', city: 'London', region: 'eu-west', coordinates: { lat: 51.4700, lng: -0.4543 }, supportsDOs: true },
  { code: 'cdg', city: 'Paris', region: 'eu-west', coordinates: { lat: 49.0097, lng: 2.5479 }, supportsDOs: true },
  { code: 'ams', city: 'Amsterdam', region: 'eu-west', coordinates: { lat: 52.3105, lng: 4.7683 }, supportsDOs: true },
  { code: 'fra', city: 'Frankfurt', region: 'eu-west', coordinates: { lat: 50.0379, lng: 8.5622 }, supportsDOs: true },
  { code: 'mrs', city: 'Marseille', region: 'eu-west', coordinates: { lat: 43.4365, lng: 5.2153 }, supportsDOs: true },
  { code: 'mxp', city: 'Milan', region: 'eu-west', coordinates: { lat: 45.6306, lng: 8.7281 }, supportsDOs: true },
  // EU East
  { code: 'prg', city: 'Prague', region: 'eu-east', coordinates: { lat: 50.1018, lng: 14.2632 }, supportsDOs: true },
  { code: 'arn', city: 'Stockholm', region: 'eu-east', coordinates: { lat: 59.6498, lng: 17.9238 }, supportsDOs: true },
  { code: 'vie', city: 'Vienna', region: 'eu-east', coordinates: { lat: 48.1103, lng: 16.5697 }, supportsDOs: true },
  // Asia-Pacific
  { code: 'sin', city: 'Singapore', region: 'asia-pacific', coordinates: { lat: 1.3644, lng: 103.9915 }, supportsDOs: true },
  { code: 'hkg', city: 'HongKong', region: 'asia-pacific', coordinates: { lat: 22.3080, lng: 113.9185 }, supportsDOs: true },
  { code: 'nrt', city: 'Tokyo', region: 'asia-pacific', coordinates: { lat: 35.7649, lng: 140.3867 }, supportsDOs: true },
  { code: 'kix', city: 'Osaka', region: 'asia-pacific', coordinates: { lat: 34.4347, lng: 135.2441 }, supportsDOs: true },
]

// ============================================================================
// ColoDataClient Class
// ============================================================================

/**
 * Client for fetching colo metadata from WHERE-DOs-Live API
 */
export class ColoDataClient {
  private baseUrl: string
  private cacheTTL: number = 5 * 60 * 1000 // Default 5 minutes
  private cache: ColoMetadata[] | null = null
  private cacheTimestamp: number = 0

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'https://where-dos-live.do.workers.dev/api'
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(): boolean {
    if (this.cacheTTL === 0) return false
    if (!this.cache) return false
    return Date.now() - this.cacheTimestamp < this.cacheTTL
  }

  /**
   * Fetch all colo metadata from API
   */
  async fetchAllColos(): Promise<ColoMetadata[]> {
    // Return cached data if valid
    if (this.isCacheValid() && this.cache) {
      return this.cache
    }

    const response = await fetch(`${this.baseUrl}/colos`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json() as ColoMetadata[]

    // Update cache
    this.cache = data
    this.cacheTimestamp = Date.now()

    return data
  }

  /**
   * Get metadata for specific colo
   */
  async getColo(code: ColoCode): Promise<ColoMetadata | null> {
    const response = await fetch(`${this.baseUrl}/colos/${code}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (response.status === 404) {
      return null
    }

    const data = await response.json() as ColoMetadata | null

    if (!data) {
      return null
    }

    return data
  }

  /**
   * Get colos that support DOs
   */
  async getDOColos(): Promise<ColoMetadata[]> {
    const allColos = await this.fetchAllColos()
    return allColos.filter(colo => colo.supportsDOs)
  }

  /**
   * Get colos by region
   */
  async getColosByRegion(region: Region): Promise<ColoMetadata[]> {
    const allColos = await this.fetchAllColos()
    return allColos.filter(colo => colo.region === region)
  }

  /**
   * Set cache TTL in milliseconds
   */
  setCacheTTL(ttl: number): void {
    this.cacheTTL = ttl
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache = null
    this.cacheTimestamp = 0
  }
}

// ============================================================================
// syncColoData Function
// ============================================================================

/**
 * Sync external data to local storage
 */
export async function syncColoData(
  client: ColoDataClient,
  storage: DurableObjectStorage
): Promise<SyncResult> {
  // Fetch all colos from client
  const colos = await client.fetchAllColos()

  // Get existing keys from storage
  const existingData = await storage.list<ColoMetadata>({ prefix: 'colo:' })
  const existingCodes = new Set<string>()
  const existingColos = new Map<string, ColoMetadata>()

  for (const [key, value] of existingData) {
    const code = key.replace('colo:', '')
    existingCodes.add(code)
    existingColos.set(code, value)
  }

  let added = 0
  let updated = 0
  let removed = 0
  let successfulTotal = 0

  // Process each colo from API
  for (const colo of colos) {
    const key = `colo:${colo.code}`

    try {
      if (existingCodes.has(colo.code)) {
        // Check if data has changed
        const existing = existingColos.get(colo.code)
        if (JSON.stringify(existing) !== JSON.stringify(colo)) {
          await storage.put(key, colo)
          updated++
        }
        existingCodes.delete(colo.code)
      } else {
        await storage.put(key, colo)
        added++
      }
      successfulTotal++
    } catch {
      // Handle partial failures gracefully - continue with other colos
    }
  }

  // Remove colos that are no longer in API response
  for (const code of existingCodes) {
    try {
      await storage.delete(`colo:${code}`)
      removed++
    } catch {
      // Handle partial failures gracefully
    }
  }

  return {
    added,
    updated,
    removed,
    total: successfulTotal,
    syncedAt: new Date(),
  }
}

// ============================================================================
// getColoWithLikelihood Function
// ============================================================================

/**
 * Get colo metadata with likelihood score
 * Always returns likelihood (defaults to 1.0 if not present)
 */
export async function getColoWithLikelihood(
  code: ColoCode,
  client: ColoDataClient
): Promise<ColoMetadata & { likelihood: number }> {
  const colo = await client.getColo(code)

  if (!colo) {
    throw new Error(`Colo not found: ${code}`)
  }

  // Ensure likelihood is always present, default to 1.0 for DO-supporting colos
  const likelihood = colo.likelihood ?? (colo.supportsDOs ? 1.0 : 0.5)

  return {
    ...colo,
    likelihood,
  }
}
