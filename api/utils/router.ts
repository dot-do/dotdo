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

// Types for consistency mode
export type ConsistencyMode = 'strong' | 'eventual' | 'causal'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

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
  nsStrategy: string
  consistencyMode?: ConsistencyMode
  replicaRegions?: string[]
  replicaCount?: number
  [key: string]: unknown
}

/**
 * Static DO route configuration
 */
export interface DORoute {
  binding: keyof Pick<Env, 'DO' | 'COLLECTION_DO' | 'BROWSER_DO' | 'SANDBOX_DO' | 'OBS_BROADCASTER'>
  nsStrategy: 'tenant' | 'singleton' | 'sharded'
  shardCount?: number
}

/**
 * Helper function to check if a string looks like an ID
 */
function isValidId(value: string): boolean {
  if (!value || !value.trim()) {
    return false
  }

  // Numeric string
  if (/^\d+$/.test(value)) {
    return true
  }

  // UUID-like or hyphenated ID
  if (/^[a-zA-Z0-9-]+$/.test(value) && value.includes('-')) {
    return true
  }

  // ULID format
  if (/^[A-Z0-9]{26}$/.test(value)) {
    return true
  }

  return false
}

/**
 * Build a query object for looking up a resource by ID or name
 */
function buildLookupQuery(value: string, noun: string): Record<string, unknown> {
  if (isValidId(value)) {
    return { $id: value }
  }
  return { name: value }
}

/**
 * Complete routing result with all information needed to forward a request
 */
export interface RoutingResult {
  /** DO binding namespace */
  binding: DurableObjectNamespace
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
 * Cached noun configurations per tenant
 */
const nounConfigCache = new Map<string, Map<string, NounConfig>>()

/**
 * Fetch noun configuration from the DO
 */
async function fetchNounConfig(
  env: Env,
  tenant: string
): Promise<Map<string, NounConfig>> {
  // Check cache first
  const cached = nounConfigCache.get(tenant)
  if (cached) {
    return cached
  }

  // Query the DO for noun config
  if (!env.DO) {
    return new Map()
  }

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

    // Cache for this tenant
    nounConfigCache.set(tenant, configMap)
    return configMap
  } catch (err) {
    console.warn(`Error fetching noun config for tenant ${tenant}:`, err)
    return new Map()
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
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * Select the nearest replica region based on location
 */
function selectNearestReplica(
  currentRegion: string,
  replicaRegions: string[],
  lat?: number,
  lon?: number
): string {
  // If current region is in replicas, use it
  if (replicaRegions.includes(currentRegion)) {
    return currentRegion
  }

  // Otherwise, return the first replica
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
async function getDOBinding(
  env: Env,
  pathname: string,
  hostname: string,
  method: string = 'GET'
): Promise<{
  binding: DurableObjectNamespace
  nsName: string
  nounConfig?: NounConfig
  isReplica: boolean
  replicaRegion?: string
  location?: LocationInfo
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
    switch (staticRoute.nsStrategy) {
      case 'singleton':
        nsName = firstSegment
        break
      case 'sharded':
        const id = segments[1] ?? ''
        const shardCount = staticRoute.shardCount ?? 16
        const hash = simpleHash(id)
        nsName = `${firstSegment}-shard-${hash % shardCount}`
        break
      case 'tenant':
      default:
        nsName = tenant
        break
    }

    return { binding, nsName, isReplica: false }
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
        nounEntry.replicaRegions.length > 0) {
      const replicaDO = (env as Record<string, unknown>).REPLICA_DO as DurableObjectNamespace | undefined
      if (replicaDO) {
        isReplica = true
        // For now, just use the first available replica
        // In production, could select based on location
        replicaRegion = nounEntry.replicaRegions[0]
      }
    }

    return {
      binding: isReplica && (env as Record<string, unknown>).REPLICA_DO ? (env as Record<string, unknown>).REPLICA_DO as DurableObjectNamespace : nsBinding,
      nsName,
      nounConfig: nounEntry,
      isReplica,
      replicaRegion,
    }
  }

  // 3. Default: use main DO binding with tenant namespace
  if (!env.DO) {
    return null
  }

  return {
    binding: env.DO,
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
    binding: doBinding.binding,
    nsName: doBinding.nsName,
    isReplica: doBinding.isReplica,
    consistencyMode,
    lookupQuery,
    normalizedPath,
    location,
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

/**
 * Export the DO binding resolver for use in index.ts
 */
export { getDOBinding, fetchNounConfig, selectNearestReplica }
