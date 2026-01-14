/**
 * Consolidated API routing logic
 *
 * This module unifies all routing decisions into a single flow:
 * - Extract location from request
 * - Parse consistency mode
 * - Normalize URL path segments
 * - Determine DO binding with replica support
 * - Build lookup query for flexible ID/name resolution
 *
 * The routeRequest function returns all routing information needed
 * to forward a request to the appropriate Durable Object instance.
 */

import type { Env } from '../types'
import { extractLocation, type LocationInfo } from './location'
import { parseConsistencyMode, shouldRouteToReplica } from './consistency'
import { normalizePathSegment } from './url'
import { findNearestReplica, type ReplicaRegion } from './geo'
import { isValidId, buildLookupQuery } from '../../utils/lookup'
import { hasReplicaDO } from '../../types/CloudflareBindings'

// Types for consistency mode
export type ConsistencyMode = 'strong' | 'eventual' | 'causal'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Namespace strategy types - discriminated union for type-safe handling
 */
export type NsStrategy = 'tenant' | 'singleton' | 'sharded'

/**
 * DO binding names that can be used in routes
 */
export type DOBindingName = keyof Pick<Env, 'DO' | 'COLLECTION_DO' | 'BROWSER_DO' | 'SANDBOX_DO' | 'OBS_BROADCASTER'>

/**
 * Noun configuration from the nouns table
 */
export interface NounConfig {
  noun: string
  plural: string | null
  doClass: string | null
  sharded: boolean
  shardCount: number
  shardKey: string | null
  storage: string
  ttlDays: number | null
  nsStrategy: NsStrategy
  consistencyMode?: ConsistencyMode
  replicaRegions?: string[]
  replicaCount?: number
  [key: string]: unknown
}

/**
 * Base route configuration shared by all strategies
 */
interface DORouteBase {
  binding: DOBindingName
}

/**
 * Tenant namespace strategy - uses hostname tenant as namespace
 */
interface DORouteTenant extends DORouteBase {
  nsStrategy: 'tenant'
}

/**
 * Singleton namespace strategy - uses fixed namespace name
 */
interface DORouteSingleton extends DORouteBase {
  nsStrategy: 'singleton'
}

/**
 * Sharded namespace strategy - distributes across multiple DOs
 */
interface DORouteSharded extends DORouteBase {
  nsStrategy: 'sharded'
  shardCount: number
}

/**
 * Static DO route configuration - discriminated union by nsStrategy
 */
export type DORoute = DORouteTenant | DORouteSingleton | DORouteSharded

/**
 * Complete routing result with all information needed to forward a request
 */
export interface RoutingResult {
  /** DO binding namespace */
  ns: DurableObjectNamespace
  /** Namespace name (tenant, shard, singleton, etc.) */
  nsName: string
  /** Whether this routes to a replica */
  isReplica: boolean
  /** Consistency mode for the request */
  consistencyMode: ConsistencyMode
  /** Optional lookup query for flexible ID/name resolution */
  lookupQuery?: Record<string, unknown>
  /** Normalized URL path */
  normalizedPath: string
  /** Location information (if available) */
  location?: LocationInfo
  /** Selected replica region (if routing to replica) */
  replicaRegion?: string
  /** Noun configuration (if found) */
  nounConfig?: NounConfig
}

// Env type is imported from ../types

// ============================================================================
// NOUN CONFIG CACHE
// ============================================================================

/**
 * Cache configuration constants
 */
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const CACHE_MAX_ENTRIES = 100

/**
 * Cache entry with TTL and in-flight promise tracking
 */
interface NounConfigCacheEntry {
  value: Map<string, NounConfig>
  expiresAt: number
  fetchPromise?: Promise<Map<string, NounConfig>>
}

/**
 * LRU-style cache with TTL support
 * Uses Map's insertion order for LRU tracking
 */
const nounConfigCache = new Map<string, NounConfigCacheEntry>()

/**
 * Check if a cache entry is still valid
 */
function isCacheEntryValid(entry: NounConfigCacheEntry): boolean {
  return Date.now() < entry.expiresAt
}

/**
 * Evict oldest entries when cache exceeds max size
 * Map maintains insertion order, so first entries are oldest
 */
function evictOldestEntries(): void {
  while (nounConfigCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = nounConfigCache.keys().next().value
    if (oldestKey !== undefined) {
      nounConfigCache.delete(oldestKey)
    } else {
      break
    }
  }
}

/**
 * Touch a cache entry to mark it as recently used (LRU update)
 * Re-insert to move to end of Map's iteration order
 */
function touchCacheEntry(tenant: string, entry: NounConfigCacheEntry): void {
  nounConfigCache.delete(tenant)
  nounConfigCache.set(tenant, entry)
}

/**
 * Fetch noun configuration from the DO with caching
 *
 * Features:
 * - 5-minute TTL for cache entries
 * - LRU eviction when cache exceeds 100 entries
 * - Promise deduplication to prevent duplicate fetches for concurrent requests
 */
export async function fetchNounConfig(
  env: Env,
  tenant: string
): Promise<Map<string, NounConfig>> {
  // Check cache first
  const cached = nounConfigCache.get(tenant)

  if (cached) {
    // If there's an in-flight fetch, wait for it (handles concurrent requests)
    if (cached.fetchPromise) {
      return cached.fetchPromise
    }

    // If cache is still valid, return it and update LRU order
    if (isCacheEntryValid(cached)) {
      touchCacheEntry(tenant, cached)
      return cached.value
    }

    // Cache expired, delete it
    nounConfigCache.delete(tenant)
  }

  // Query the DO for noun config
  if (!env.DO) {
    return new Map()
  }

  // Create the fetch promise and store it in cache to deduplicate concurrent requests
  const fetchPromise = (async (): Promise<Map<string, NounConfig>> => {
    try {
      const id = env.DO.idFromName(tenant)
      const stub = env.DO.get(id)

      // Query the nouns table via the DO's /nouns endpoint
      const response = await stub.fetch(new Request('https://internal/nouns', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      }))

      if (!response.ok) {
        console.warn(`Failed to fetch noun config for tenant ${tenant}: ${response.status}`)
        // Clean up the pending entry on failure
        nounConfigCache.delete(tenant)
        return new Map()
      }

      const data = await response.json() as { items?: NounConfig[] } | NounConfig[]
      const nouns = Array.isArray(data) ? data : (data.items ?? [])

      // Build lookup map by lowercase plural (the route path)
      const configMap = new Map<string, NounConfig>()
      for (const noun of nouns) {
        const key = (noun.plural ?? noun.noun).toLowerCase()
        configMap.set(key, noun)
      }

      // Evict oldest entries if cache is full
      evictOldestEntries()

      // Update cache entry with the resolved value and new expiration
      nounConfigCache.set(tenant, {
        value: configMap,
        expiresAt: Date.now() + CACHE_TTL_MS,
        // Clear the fetchPromise since we're done
      })

      return configMap
    } catch (err) {
      console.warn(`Error fetching noun config for tenant ${tenant}:`, err)
      // Clean up the pending entry on error
      nounConfigCache.delete(tenant)
      return new Map()
    }
  })()

  // Store entry with pending promise to deduplicate concurrent requests
  nounConfigCache.set(tenant, {
    value: new Map(), // Placeholder until fetch completes
    expiresAt: Date.now() + CACHE_TTL_MS,
    fetchPromise,
  })

  return fetchPromise
}

/**
 * Clear the noun config cache (useful for testing)
 */
export function clearNounConfigCache(): void {
  nounConfigCache.clear()
}

/**
 * Get cache statistics (useful for monitoring/debugging)
 */
export function getNounConfigCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return {
    size: nounConfigCache.size,
    maxSize: CACHE_MAX_ENTRIES,
    ttlMs: CACHE_TTL_MS,
  }
}

// ============================================================================
// STATIC ROUTES
// ============================================================================

/**
 * Static route overrides for special DO bindings
 * These take precedence over noun config
 */
const STATIC_DO_ROUTES: Record<string, DORoute> = {
  'browsers': { binding: 'BROWSER_DO', nsStrategy: 'tenant' },
  'sandboxes': { binding: 'SANDBOX_DO', nsStrategy: 'tenant' },
  'obs': { binding: 'OBS_BROADCASTER', nsStrategy: 'singleton' },
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract tenant from hostname
 * Examples:
 * - acme.api.dotdo.dev → 'acme'
 * - localhost:8787 → 'default'
 * - api.dotdo.dev → 'default'
 */
export function getTenantFromHostname(hostname: string): string {
  const hostParts = hostname.split('.')
  // If 3+ parts (e.g., tenant.api.dotdo.dev), use first part
  return hostParts.length > 2 ? (hostParts[0] ?? 'default') : 'default'
}

/**
 * Simple hash function for sharding
 */
export function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * Region coordinates mapping for common Cloudflare/AWS/GCP region identifiers.
 * Maps region strings to approximate lat/lon coordinates.
 */
export const REGION_COORDINATES: Record<string, { lat: number; lon: number }> = {
  // Cloudflare regions
  'wnam': { lat: 37.7749, lon: -122.4194 },    // Western North America (San Francisco)
  'enam': { lat: 40.7128, lon: -74.0060 },     // Eastern North America (New York)
  'weur': { lat: 51.5074, lon: -0.1278 },      // Western Europe (London)
  'eeur': { lat: 50.1109, lon: 8.6821 },       // Eastern Europe (Frankfurt)
  'apac': { lat: 1.3521, lon: 103.8198 },      // Asia Pacific (Singapore)

  // Common region names
  'us-west': { lat: 37.7749, lon: -122.4194 },    // San Francisco
  'us-west-1': { lat: 37.7749, lon: -122.4194 },  // San Francisco
  'us-west-2': { lat: 45.5152, lon: -122.6784 },  // Portland
  'us-east': { lat: 40.7128, lon: -74.0060 },     // New York
  'us-east-1': { lat: 38.9072, lon: -77.0369 },   // Northern Virginia
  'us-east-2': { lat: 39.9612, lon: -82.9988 },   // Ohio
  'us-central': { lat: 41.8781, lon: -87.6298 },  // Chicago
  'us-central-1': { lat: 41.2565, lon: -95.9345 }, // Council Bluffs (Iowa)

  'eu-west': { lat: 51.5074, lon: -0.1278 },      // London
  'eu-west-1': { lat: 53.3498, lon: -6.2603 },    // Dublin
  'eu-west-2': { lat: 51.5074, lon: -0.1278 },    // London
  'eu-west-3': { lat: 48.8566, lon: 2.3522 },     // Paris
  'eu-central': { lat: 50.1109, lon: 8.6821 },    // Frankfurt
  'eu-central-1': { lat: 50.1109, lon: 8.6821 },  // Frankfurt
  'eu-north-1': { lat: 59.3293, lon: 18.0686 },   // Stockholm

  'ap-southeast': { lat: 1.3521, lon: 103.8198 },     // Singapore
  'ap-southeast-1': { lat: 1.3521, lon: 103.8198 },   // Singapore
  'ap-southeast-2': { lat: -33.8688, lon: 151.2093 }, // Sydney
  'ap-northeast': { lat: 35.6762, lon: 139.6503 },    // Tokyo
  'ap-northeast-1': { lat: 35.6762, lon: 139.6503 },  // Tokyo
  'ap-northeast-2': { lat: 37.5665, lon: 126.9780 },  // Seoul
  'ap-south-1': { lat: 19.0760, lon: 72.8777 },       // Mumbai

  'sa-east-1': { lat: -23.5505, lon: -46.6333 },  // Sao Paulo
  'me-south-1': { lat: 26.0667, lon: 50.5577 },   // Bahrain
  'af-south-1': { lat: -33.9249, lon: 18.4241 },  // Cape Town
}

/**
 * Select the nearest replica region based on geographic distance.
 * Uses haversine formula for accurate great-circle distance calculation.
 */
export function selectNearestReplica(
  currentRegion: string,
  replicaRegions: string[],
  lat?: number,
  lon?: number
): string {
  // If no replicas provided, return unknown
  if (!replicaRegions || replicaRegions.length === 0) {
    return 'unknown'
  }

  // If current region is in replicas, use it (optimal case)
  if (replicaRegions.includes(currentRegion)) {
    return currentRegion
  }

  // If we have user coordinates, use geographic distance calculation
  if (lat !== undefined && lon !== undefined && !isNaN(lat) && !isNaN(lon)) {
    // Convert region strings to ReplicaRegion objects with coordinates
    const regionsWithCoords: ReplicaRegion[] = []
    for (const regionId of replicaRegions) {
      const coords = REGION_COORDINATES[regionId.toLowerCase()]
      if (coords) {
        regionsWithCoords.push({
          id: regionId,
          lat: coords.lat,
          lon: coords.lon,
          binding: `DO_${regionId.toUpperCase().replace(/-/g, '_')}`,
        })
      }
    }

    // If we have at least one region with coordinates, find the nearest
    if (regionsWithCoords.length > 0) {
      const nearest = findNearestReplica({ lat, lon }, regionsWithCoords)
      if (nearest) {
        return nearest.id
      }
    }
  }

  // Fall back to first replica if no coordinates available
  return replicaRegions[0] ?? 'unknown'
}

/**
 * Determine the DO binding and namespace for a request
 *
 * Routing priority:
 * 1. Static routes (STATIC_DO_ROUTES) for special DO bindings
 * 2. Noun config from the nouns table (sharding, storage tier, etc.)
 * 3. Default: main DO binding with tenant namespace
 */
export async function getDOBinding(
  env: Env,
  pathname: string,
  hostname: string,
  method: string = 'GET',
  location?: LocationInfo
): Promise<{
  ns: DurableObjectNamespace
  nsName: string
  nounConfig?: NounConfig
  isReplica: boolean
  replicaRegion?: string
  locationHint?: LocationInfo
} | null> {
  // Extract first path segment (e.g., '/browsers/123' → 'browsers')
  const segments = pathname.slice(1).split('/')
  const firstSegment = segments[0]?.toLowerCase() ?? ''
  const tenant = getTenantFromHostname(hostname)
  const httpMethod = method.toUpperCase()
  const isReadOperation = httpMethod === 'GET' || httpMethod === 'HEAD'

  // 1. Check for static route overrides first (never use replicas for static routes)
  const staticRoute = STATIC_DO_ROUTES[firstSegment]
  if (staticRoute) {
    const binding = env[staticRoute.binding]
    if (!binding) {
      return null // Binding not available
    }

    let nsName: string
    // Discriminated union type narrowing ensures type-safe access
    switch (staticRoute.nsStrategy) {
      case 'singleton':
        nsName = firstSegment
        break
      case 'sharded': {
        // Type narrowed: staticRoute is DORouteSharded with required shardCount
        const id = segments[1] ?? ''
        const hash = simpleHash(id)
        nsName = `${firstSegment}-shard-${hash % staticRoute.shardCount}`
        break
      }
      case 'tenant':
        nsName = tenant
        break
    }

    return { ns: binding, nsName, isReplica: false }
  }

  // 2. Check noun config from the nouns table
  const nounConfig = await fetchNounConfig(env, tenant)
  const nounEntry = nounConfig.get(firstSegment)

  if (nounEntry) {
    // Determine binding based on doClass
    const bindingName = nounEntry.doClass as keyof Env | null
    const binding = bindingName ? env[bindingName] as DurableObjectNamespace | undefined : env.DO
    if (!binding) {
      // Fall back to default DO if specified binding not available
      if (!env.DO) return null
    }

    const nsBinding = binding ?? env.DO
    if (!nsBinding) return null

    let nsName: string
    const nsStrategy = nounEntry.nsStrategy || 'tenant'

    switch (nsStrategy) {
      case 'singleton':
        nsName = firstSegment
        break
      case 'sharded':
        const id = segments[1] ?? ''
        const shardCount = nounEntry.shardCount ?? 16
        const hash = simpleHash(id)
        nsName = `${firstSegment}-shard-${hash % shardCount}`
        break
      case 'tenant':
      default:
        nsName = tenant
        break
    }

    // Check if we should route to a replica for this request
    let isReplica = false
    let replicaRegion: string | undefined

    // Only route reads to replicas
    if (isReadOperation &&
        nounEntry.consistencyMode === 'eventual' &&
        nounEntry.replicaRegions &&
        nounEntry.replicaRegions.length > 0 &&
        hasReplicaDO(env)) {
      isReplica = true
      // Select nearest replica using geographic distance
      replicaRegion = selectNearestReplica(
        location?.region ?? '',
        nounEntry.replicaRegions,
        location?.lat,
        location?.lon
      )
    }

    // Use type guard to safely access REPLICA_DO - if isReplica is true, hasReplicaDO was already checked
    const resolvedNs = isReplica && hasReplicaDO(env) ? env.REPLICA_DO : nsBinding
    return {
      ns: resolvedNs,
      nsName,
      nounConfig: nounEntry,
      isReplica,
      replicaRegion,
      locationHint: location,
    }
  }

  // 3. Default: use main DO binding with tenant namespace
  if (!env.DO) {
    return null
  }

  return {
    ns: env.DO,
    nsName: tenant,
    isReplica: false,
  }
}

// ============================================================================
// MAIN ROUTING FUNCTION
// ============================================================================

/**
 * Route a request to the appropriate Durable Object
 *
 * This function consolidates all routing decisions:
 * 1. Extracts location from Cloudflare headers
 * 2. Parses consistency mode from headers/query params
 * 3. Normalizes URL path segments
 * 4. Determines DO binding with replica support
 * 5. Builds lookup query for flexible ID/name resolution
 *
 * @param env - Cloudflare environment with DO bindings
 * @param request - The incoming HTTP request
 * @returns Complete routing information for forwarding the request
 */
export async function routeRequest(
  env: Env,
  request: Request
): Promise<RoutingResult | null> {
  const url = new URL(request.url)
  const pathname = url.pathname
  const hostname = url.hostname
  const method = request.method

  // 1. Extract location from Cloudflare headers
  const location = extractLocation(request)

  // 2. Get DO binding and namespace
  const doBinding = await getDOBinding(env, pathname, hostname, method)
  if (!doBinding) {
    return null
  }

  // 3. Parse consistency mode
  const consistencyMode = parseConsistencyMode(request, doBinding.nounConfig)

  // 4. Normalize URL path segments (handle underscores)
  const normalizedSegments = pathname
    .slice(1)
    .split('/')
    .map(seg => normalizePathSegment(seg))
  const normalizedPath = '/' + normalizedSegments.join('/')

  // 5. Build lookup query for flexible ID/name resolution (if applicable)
  // This is used when the second path segment is a lookup value
  let lookupQuery: Record<string, unknown> | undefined
  const segments = pathname.slice(1).split('/')
  if (segments.length >= 2 && segments[1]) {
    const lookupValue = normalizePathSegment(segments[1])
    // Only build lookup query if it's not a UUID or ULID (keep as-is for exact ID match)
    if (!isValidId(lookupValue)) {
      // This is a name or flexible lookup value
      const nounName = segments[0]?.toLowerCase()
      if (nounName) {
        lookupQuery = buildLookupQuery(lookupValue, nounName)
      }
    }
  }

  return {
    ns: doBinding.ns,
    nsName: doBinding.nsName,
    isReplica: doBinding.isReplica,
    consistencyMode,
    lookupQuery,
    normalizedPath,
    location: location ?? undefined,
    replicaRegion: doBinding.replicaRegion,
    nounConfig: doBinding.nounConfig,
  }
}

/**
 * Extract location info from Cloudflare headers (for backward compatibility)
 *
 * Cloudflare provides location data via cf object on the request.
 * This wrapper extracts it and returns a LocationInfo object.
 *
 * @param req - Request context (can be Hono request or raw Request)
 * @returns LocationInfo if available, undefined otherwise
 */
export function extractLocationFromHeaders(req: any): LocationInfo | undefined {
  try {
    // Try to extract from Cloudflare cf object on request
    const cf = (req as any).cf || (req as any).raw?.cf
    if (!cf) {
      return undefined
    }

    const colo = cf.colo || 'unknown'
    const region = cf.region || 'unknown'
    const country = cf.country || 'unknown'
    const lat = parseFloat(cf.latitude || '0')
    const lon = parseFloat(cf.longitude || '0')

    // Return if we have valid location info
    if (colo !== 'unknown' && region !== 'unknown' && !isNaN(lat) && !isNaN(lon)) {
      return { colo, region, country, lat, lon }
    }

    // Try extracting from Cloudflare headers if cf object not available
    if (req.header) {
      const cfRay = req.header('CF-Ray')
      const headerColo = cfRay?.split('-')[1] || 'unknown'
      const headerRegion = req.header('CF-IPCountry') || 'unknown'
      const headerCountry = req.header('CF-IPCountry') || 'unknown'
      const headerLat = parseFloat(req.header('CF-IPLatitude') || '0')
      const headerLon = parseFloat(req.header('CF-IPLongitude') || '0')

      if (!isNaN(headerLat) && !isNaN(headerLon) && headerRegion !== 'unknown') {
        return { colo: headerColo, region: headerRegion, country: headerCountry, lat: headerLat, lon: headerLon }
      }
    }
  } catch {
    // Silently fail - location info is optional
  }

  return undefined
}

// All exports are done inline with function declarations above
