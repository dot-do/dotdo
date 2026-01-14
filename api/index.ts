/**
 * dotdo Worker - Unified API Layer
 *
 * This module provides a unified API layer that routes requests to the
 * appropriate Durable Object (DO). Supports multiple DO bindings, sharding,
 * replica routing, and analytics queries.
 *
 * Architecture:
 * - Request → Worker → Route to DO binding → DO.fetch() → rest-router.ts
 * - All REST operations handled by the target DO
 * - JSON-LD formatted responses with $context, $id, $type
 *
 * DO Routing:
 * - Default: env.DO - main data store
 * - /test-collection: env.COLLECTION_DO - test collection DO
 * - Sharding: Based on collection/id hashing
 *
 * Analytics Routing:
 * - /analytics/* → IcebergMetadataDO for R2 Iceberg queries
 * - /query/* → Cross-DO scatter-gather for sharded queries
 *
 * Exports:
 * - default: Cloudflare Worker with fetch handler
 * - app: Hono app for testing (wraps DO)
 * - DO: Durable Object class
 */
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { analyticsRouter } from './analytics/router'
import {
  routeRequest,
  getTenantFromHostname,
  fetchNounConfig,
  getDOBinding,
  selectNearestReplica,
  extractLocationFromHeaders,
  type NounConfig,
} from './utils/router'
import { createRoutingSpan, addRoutingHeaders, RoutingDebugInfo } from './utils/routing-telemetry'
import { parseConsistencyMode, shouldRouteToReplica } from './utils/consistency'

export { DO } from '../objects/DO'
export type { LocationInfo } from './utils/location'

// ============================================================================
// DO ROUTING
// ============================================================================

/**
 * Route configuration for different DO bindings
 *
 * Maps route prefixes to DO bindings and namespace strategies.
 * Default binding is 'DO' for unmatched routes.
 */
interface DORoute {
  /** DO binding name in env */
  binding: keyof Pick<Env, 'DO' | 'COLLECTION_DO' | 'BROWSER_DO' | 'SANDBOX_DO' | 'OBS_BROADCASTER'>
  /** Namespace strategy: 'tenant' (from hostname), 'singleton', 'sharded' */
  nsStrategy: 'tenant' | 'singleton' | 'sharded'
  /** For sharded strategy, number of shards */
  shardCount?: number
}

// NounConfig interface and fetchNounConfig function are imported from ./utils/router
// See router.ts for implementations

/**
 * Static route overrides for special DO bindings
 * These take precedence over noun config
 */
const STATIC_DO_ROUTES: Record<string, DORoute> = {
  'browsers': { binding: 'BROWSER_DO', nsStrategy: 'tenant' },
  'sandboxes': { binding: 'SANDBOX_DO', nsStrategy: 'tenant' },
  'obs': { binding: 'OBS_BROADCASTER', nsStrategy: 'singleton' },
}

/**
 * Location information for replica selection
 */
interface LocationInfo {
  colo: string          // Cloudflare colo identifier
  region: string        // AWS region code
  lat: number           // Latitude
  lon: number           // Longitude
}

/**
 * Extract location info from Cloudflare headers
 *
 * Cloudflare provides location data via CF-IPCountry, CF-Metro-Code, etc.
 * For testing/mock purposes, this provides a safe fallback.
 *
 * @param req - Hono request context
 * @returns LocationInfo if available, undefined otherwise
 */
function extractLocationFromHeaders(req: any): LocationInfo | undefined {
  try {
    // Try to extract from Cloudflare headers
    const colo = req.header('CF-Ray')?.split('-')[1] || 'unknown'
    const region = req.header('CF-IPCountry') || 'unknown'
    const lat = parseFloat(req.header('CF-IPLatitude') || '0')
    const lon = parseFloat(req.header('CF-IPLongitude') || '0')

    // Return if we have valid coordinates
    if (!isNaN(lat) && !isNaN(lon) && region !== 'unknown') {
      return { colo, region, lat, lon }
    }
  } catch {
    // Silently fail - location info is optional
  }

  return undefined
}

/**
 * Get DO binding and namespace for a request
 *
 * Routing priority:
 * 1. Static routes (STATIC_DO_ROUTES) for special DO bindings
 * 2. Noun config from the nouns table (sharding, storage tier, etc.)
 * 3. Default: main DO binding with tenant namespace
 *
 * With replica support:
 * - Read operations (GET) to eventual consistency data route to replicas if available
 * - Write operations (POST, PUT, DELETE) always route to primary
 * - Strong consistency always uses primary
 *
 * @param env - Cloudflare env with DO bindings
 * @param pathname - Request pathname
 * @param hostname - Request hostname for tenant derivation
 * @param method - HTTP method (GET, POST, etc.) - defaults to 'GET'
 * @param location - Request location info for replica selection
 * @returns DO namespace binding, namespace string, and replica info
 */
async function getDOBinding(
  env: Env,
  pathname: string,
  hostname: string,
  method?: string,
  location?: LocationInfo
): Promise<{ ns: DurableObjectNamespace; nsName: string; nounConfig?: NounConfig; isReplica?: boolean; replicaRegion?: string; locationHint?: LocationInfo } | null> {
  // Extract first path segment (e.g., '/browsers/123' → 'browsers')
  const segments = pathname.slice(1).split('/')
  const firstSegment = segments[0]?.toLowerCase() ?? ''
  const tenant = getTenantFromHostname(hostname)
  const httpMethod = (method || 'GET').toUpperCase()
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

    // ========================================================================
    // REPLICA ROUTING LOGIC
    // ========================================================================
    // For read operations with eventual consistency and replicas configured:
    // - Route to nearest replica only if location is in replica regions
    // For all other cases (writes, strong consistency, or location outside replicas):
    // - Route to primary

    if (isReadOperation && location &&
        nounEntry.consistencyMode === 'eventual' &&
        nounEntry.replicaRegions &&
        nounEntry.replicaRegions.length > 0) {

      // Check if location's region is in the replica regions
      if (nounEntry.replicaRegions.includes(location.region)) {
        // We have replicas configured and this is a read with eventual consistency
        const replicaDO = (env as Record<string, unknown>).REPLICA_DO as DurableObjectNamespace | undefined

        if (replicaDO) {
          // Select the nearest replica based on location region
          const selectedReplica = selectNearestReplica(
            location.region,
            nounEntry.replicaRegions,
            location.lat,
            location.lon
          )

          return {
            ns: replicaDO,
            nsName,
            nounConfig: nounEntry,
            isReplica: true,
            replicaRegion: selectedReplica,
            locationHint: location,
          }
        }
      }
      // If location is outside replica regions, fall back to primary below
    }

    // Default: primary binding
    const result: { ns: DurableObjectNamespace; nsName: string; nounConfig?: NounConfig; isReplica?: boolean; locationHint?: LocationInfo } = {
      ns: nsBinding,
      nsName,
      nounConfig: nounEntry,
      isReplica: false,
    }

    // Include locationHint if location was provided
    if (location) {
      result.locationHint = location
    }

    return result
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

/**
 * Select the nearest replica region based on location
 *
 * Strategy:
 * 1. If location region is in available replicas, use it
 * 2. Otherwise, use the first available replica (could be enhanced with lat/lon distance)
 *
 * @param currentRegion - Current region from location info
 * @param replicaRegions - Available replica regions
 * @param lat - Latitude for distance calculation (optional)
 * @param lon - Longitude for distance calculation (optional)
 * @returns Selected replica region
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

  // Otherwise, return the first replica (simple strategy)
  // In production, could use lat/lon to calculate actual geographic distance
  return replicaRegions[0] ?? 'unknown'
}

// Functions imported from ./utils/router:
// - getTenantFromHostname
// - getNamespace
// - simpleHash
// See router.ts for implementations

// ============================================================================
// SCATTER-GATHER FOR SHARDED QUERIES
// ============================================================================

/**
 * Configuration for scatter-gather queries
 */
interface ScatterGatherConfig {
  /** DO binding to query */
  binding: DurableObjectNamespace
  /** Number of shards */
  shardCount: number
  /** Shard prefix (e.g., 'events-shard-') */
  shardPrefix: string
  /** Tenant namespace */
  tenant: string
  /** Timeout per shard in ms */
  timeout?: number
}

/**
 * Scatter-gather query across all shards
 *
 * Fans out the request to all shards in parallel, then merges results.
 * Used for queries that need to search across partitioned data.
 *
 * @param request - The request to scatter
 * @param config - Scatter-gather configuration
 * @returns Merged response from all shards
 */
async function scatterGather(
  request: Request,
  config: ScatterGatherConfig
): Promise<{ results: unknown[]; errors: Array<{ shard: number; error: string }> }> {
  const { binding, shardCount, shardPrefix, tenant, timeout = 5000 } = config

  // Fan out to all shards in parallel
  const shardPromises = Array.from({ length: shardCount }, async (_, i) => {
    const shardName = `${tenant}:${shardPrefix}${i}`
    const id = binding.idFromName(shardName)
    const stub = binding.get(id)

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await stub.fetch(request.clone(), { signal: controller.signal })
      clearTimeout(timeoutId)

      if (!response.ok) {
        return { shard: i, error: `HTTP ${response.status}`, data: null }
      }

      const data = await response.json()
      return { shard: i, error: null, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { shard: i, error: message, data: null }
    }
  })

  const shardResults = await Promise.all(shardPromises)

  // Merge results and collect errors
  const results: unknown[] = []
  const errors: Array<{ shard: number; error: string }> = []

  for (const result of shardResults) {
    if (result.error) {
      errors.push({ shard: result.shard, error: result.error })
    } else if (result.data) {
      // If data is an array, spread it; otherwise push as-is
      if (Array.isArray(result.data)) {
        results.push(...result.data)
      } else if (result.data && typeof result.data === 'object' && 'items' in result.data) {
        // Collection response with items array
        results.push(...(result.data as { items: unknown[] }).items)
      } else {
        results.push(result.data)
      }
    }
  }

  return { results, errors }
}

/**
 * Get all shard stubs for a sharded DO
 */
function getShardStubs(
  binding: DurableObjectNamespace,
  shardPrefix: string,
  shardCount: number,
  tenant: string
): DurableObjectStub[] {
  return Array.from({ length: shardCount }, (_, i) => {
    const shardName = `${tenant}:${shardPrefix}${i}`
    const id = binding.idFromName(shardName)
    return binding.get(id)
  })
}

// ============================================================================
// READ REPLICA ROUTING
// ============================================================================

/**
 * Route read requests to replicas for load balancing
 *
 * Strategy:
 * - Writes always go to primary
 * - Reads can go to replicas (round-robin or random)
 * - Supports eventual consistency mode
 *
 * @param env - Environment with DO bindings
 * @param pathname - Request path
 * @param hostname - Request hostname
 * @param isRead - Whether this is a read operation
 * @returns DO stub to use
 */
function getReplicaAwareBinding(
  env: Env,
  pathname: string,
  hostname: string,
  isRead: boolean
): { ns: DurableObjectNamespace; nsName: string; isReplica: boolean } | null {
  const tenant = getTenantFromHostname(hostname)

  // For now, we use the primary for all operations
  // Replica routing can be enabled by setting REPLICA_DO binding
  // and configuring replica count
  const replicaDO = (env as Record<string, unknown>).REPLICA_DO as DurableObjectNamespace | undefined

  if (isRead && replicaDO) {
    // Route reads to replica (simple random selection)
    const replicaCount = 3 // Could be configurable
    const replicaIndex = Math.floor(Math.random() * replicaCount)
    return {
      ns: replicaDO,
      nsName: `${tenant}:replica-${replicaIndex}`,
      isReplica: true,
    }
  }

  // Default: use primary
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
// HONO APP - For testing and direct use
// ============================================================================

/**
 * Hono app that forwards all requests to the DO
 *
 * This provides:
 * - CORS handling
 * - Request ID tracking
 * - Unified routing through DO
 */
export const app = new Hono<{ Bindings: Env }>()

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}))

// Request ID middleware
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID()
  c.header('X-Request-ID', requestId)
  await next()
})

// Health check - handled directly (not forwarded to DO)
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

app.all('/api/health', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET' } },
    405,
    { Allow: 'GET' }
  )
})

// API info
app.get('/api', (c) => {
  return c.json({
    name: 'dotdo',
    version: '0.1.0',
    endpoints: ['/api/health', '/:collection', '/:collection/:id'],
  })
})

app.get('/api/', (c) => {
  return c.json({
    name: 'dotdo',
    version: '0.1.0',
    endpoints: ['/api/health', '/:collection', '/:collection/:id'],
  })
})

// ============================================================================
// ANALYTICS ROUTES - Mounted from analyticsRouter
// ============================================================================

/**
 * Mount analytics router for R2 Iceberg, vector search, and SQL queries
 *
 * Routes handled:
 * - POST /analytics/v1/search - Vector similarity search
 * - GET /analytics/v1/lookup/:table/:key - Point lookup (Iceberg)
 * - POST /analytics/v1/query - SQL query execution
 * - GET /analytics/v1/health - Analytics health check
 * - POST /analytics/v1/classify - Query classification
 */
app.route('/analytics', analyticsRouter)

// ============================================================================
// SCATTER-GATHER QUERY ROUTES
// ============================================================================

/**
 * POST /query - Execute query with automatic noun config detection
 *
 * This endpoint automatically detects the noun type from the collection parameter,
 * fetches the noun config to determine routing (sharding, consistency, replicas),
 * and applies appropriate routing logic.
 *
 * Request body:
 * {
 *   collection: string,      // Collection to query (e.g., 'customers', 'events')
 *   filter?: object,         // Filter criteria
 *   sort?: { field: string, order: 'asc' | 'desc' },
 *   limit?: number,          // Default: 100
 *   offset?: number,         // Default: 0
 *   consistency?: string,    // Optional: override consistency mode
 * }
 *
 * Response:
 * {
 *   results: array,          // Merged results from all shards
 *   meta: {
 *     total: number,         // Total matching items
 *     shards: number,        // Number of shards queried
 *     consistency: string,   // Consistency mode used
 *     routed_to_replica: boolean,  // Whether routed to replica
 *     errors: array,         // Any shard errors
 *   },
 * }
 */
app.post('/query', async (c) => {
  const env = c.env
  const url = new URL(c.req.url)
  const tenant = getTenantFromHostname(url.hostname)

  // Parse query request
  let body: {
    collection?: string
    filter?: Record<string, unknown>
    sort?: { field: string; order: 'asc' | 'desc' }
    limit?: number
    offset?: number
    consistency?: string
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  if (!env.DO) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'DO binding not available' } }, 503)
  }

  // Extract collection name and normalize
  const collection = (body.collection ?? 'things').toLowerCase()

  // Fetch noun config to determine routing
  const nounConfig = await fetchNounConfig(env, tenant)
  const config = nounConfig.get(collection)

  // Parse consistency mode from request or config
  const queryRequest = new Request(new URL(`/${collection}`, url.origin).toString(), {
    method: 'GET',
    headers: c.req.raw.headers,
  })
  const consistencyMode = body.consistency
    ? (body.consistency as 'strong' | 'eventual' | 'causal')
    : parseConsistencyMode(queryRequest, config)

  // Build the query URL parameters
  const queryParams = new URLSearchParams()
  if (body.filter) queryParams.set('filter', JSON.stringify(body.filter))
  if (body.sort) queryParams.set('sort', `${body.sort.field}:${body.sort.order}`)
  if (body.limit) queryParams.set('limit', String(body.limit))
  if (body.offset) queryParams.set('offset', String(body.offset))
  if (consistencyMode && consistencyMode !== 'eventual') {
    queryParams.set('consistency', consistencyMode)
  }

  const queryUrl = `/${collection}?${queryParams.toString()}`
  const finalQueryRequest = new Request(new URL(queryUrl, url.origin).toString(), {
    method: 'GET',
    headers: c.req.raw.headers,
  })

  // Determine if we should use sharding
  const isSharded = config && config.sharded
  let routedToReplica = false

  if (isSharded && config) {
    // Use scatter-gather for sharded collections
    const binding = config.doClass ? (env[config.doClass as keyof Env] as DurableObjectNamespace | undefined) : env.DO
    if (!binding) {
      return c.json({
        error: {
          code: 'INVALID_CONFIG',
          message: `Unknown binding: ${config.doClass}`,
        },
      }, 400)
    }

    // Build shard prefix from noun name
    const shardPrefix = `${collection}-shard-`

    const { results, errors } = await scatterGather(finalQueryRequest, {
      binding,
      shardCount: config.shardCount,
      shardPrefix,
      tenant,
      timeout: 10000,
    })

    // Apply client-side sort and pagination on merged results
    let sortedResults = results as Array<Record<string, unknown>>
    if (body.sort && sortedResults.length > 0) {
      const { field, order } = body.sort
      sortedResults = sortedResults.sort((a, b) => {
        const aVal = a[field]
        const bVal = b[field]
        if (aVal === bVal) return 0
        const cmp = (aVal ?? '') < (bVal ?? '') ? -1 : 1
        return order === 'desc' ? -cmp : cmp
      })
    }

    const offset = body.offset ?? 0
    const limit = body.limit ?? 100
    const paginatedResults = sortedResults.slice(offset, offset + limit)

    return c.json({
      results: paginatedResults,
      meta: {
        total: sortedResults.length,
        shards: config.shardCount,
        consistency: consistencyMode,
        routed_to_replica: routedToReplica,
        errors: errors.length > 0 ? errors : undefined,
      },
    })
  }

  // Single DO query (non-sharded) - determine routing
  const binding = config?.doClass ? (env[config.doClass as keyof Env] as DurableObjectNamespace | undefined) : env.DO
  if (!binding) {
    return c.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'DO binding not available',
        },
      },
      503
    )
  }

  // Check if should route to replica for this read operation
  const location = extractLocationFromHeaders(c.req)
  if (location && shouldRouteToReplica('GET', consistencyMode) && config?.replicaRegions && config.replicaRegions.length > 0) {
    // Check if location is in replica regions
    if (config.replicaRegions.includes(location.region)) {
      const replicaBinding = (env as Record<string, unknown>).REPLICA_DO as DurableObjectNamespace | undefined
      if (replicaBinding) {
        const selectedReplica = selectNearestReplica(
          location.region,
          config.replicaRegions,
          location.lat,
          location.lon
        )
        const id = replicaBinding.idFromName(tenant)
        const stub = replicaBinding.get(id)
        const response = await stub.fetch(finalQueryRequest)
        routedToReplica = true

        if (!response.ok) {
          return response
        }

        const data = await response.json() as { items?: unknown[] } | unknown[]
        const items = Array.isArray(data) ? data : (data.items ?? [])

        return c.json({
          results: items,
          meta: {
            total: items.length,
            shards: 1,
            consistency: consistencyMode,
            routed_to_replica: true,
            replica_region: selectedReplica,
          },
        })
      }
    }
  }

  // Default: query primary DO
  const id = binding.idFromName(tenant)
  const stub = binding.get(id)
  const response = await stub.fetch(finalQueryRequest)

  if (!response.ok) {
    return response
  }

  const data = await response.json() as { items?: unknown[] } | unknown[]
  const items = Array.isArray(data) ? data : (data.items ?? [])

  return c.json({
    results: items,
    meta: {
      total: items.length,
      shards: 1,
      consistency: consistencyMode,
      routed_to_replica: routedToReplica,
    },
  })
})

/**
 * POST /query/aggregate - Execute aggregation query across shards
 *
 * Supports: count, sum, avg, min, max, group_by
 */
app.post('/query/aggregate', async (c) => {
  const env = c.env
  const url = new URL(c.req.url)
  const tenant = getTenantFromHostname(url.hostname)

  let body: {
    collection?: string
    aggregation: {
      type: 'count' | 'sum' | 'avg' | 'min' | 'max'
      field?: string
      groupBy?: string
    }
    filter?: Record<string, unknown>
    shardConfig?: {
      binding: string
      prefix: string
      count: number
    }
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  if (!body.aggregation) {
    return c.json({ error: { code: 'INVALID_REQUEST', message: 'aggregation is required' } }, 400)
  }

  if (!env.DO) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'DO binding not available' } }, 503)
  }

  // For now, return a placeholder - aggregations require custom DO support
  return c.json({
    result: null,
    meta: {
      aggregationType: body.aggregation.type,
      field: body.aggregation.field,
      groupBy: body.aggregation.groupBy,
      message: 'Aggregation queries require custom DO implementation',
    },
  })
})

// Forward /api/* routes to DO (stripping /api prefix)
app.all('/api/*', async (c) => {
  const env = c.env
  const url = new URL(c.req.url)
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID()

  // Start routing telemetry span
  const routingSpan = createRoutingSpan(requestId, url.pathname, c.req.method)

  try {
    // Strip /api prefix for DO routing
    const pathWithoutApi = url.pathname.replace(/^\/api/, '') || '/'

    // Extract location info from CF headers (if available)
    const location = extractLocationFromHeaders(c.req)

    // Get appropriate DO binding based on route
    const doBinding = await getDOBinding(
      env,
      pathWithoutApi,
      url.hostname,
      c.req.method,
      location
    )
    if (!doBinding) {
      // Log routing failure
      routingSpan.end({
        targetBinding: 'none',
        consistencyMode: 'unknown',
        isReplica: false,
      })
      return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'DO binding not available' } }, 503)
    }

    // Log successful routing decision
    const targetBindingName = doBinding.ns === env.DO ? 'DO' :
                             doBinding.ns === env.REPLICA_DO ? 'REPLICA_DO' :
                             doBinding.ns === env.BROWSER_DO ? 'BROWSER_DO' :
                             doBinding.ns === env.SANDBOX_DO ? 'SANDBOX_DO' :
                             doBinding.ns === env.COLLECTION_DO ? 'COLLECTION_DO' :
                             'DO'

    routingSpan.end({
      targetBinding: targetBindingName,
      consistencyMode: 'eventual',
      isReplica: doBinding.isReplica ?? false,
      replicaRegion: doBinding.replicaRegion,
      nounName: pathWithoutApi.split('/')[1],
      colo: location?.colo,
      region: location?.region,
      lat: location?.lat,
      lon: location?.lon,
    })

    const doUrl = new URL(pathWithoutApi + url.search, url.origin)

    const id = doBinding.ns.idFromName(doBinding.nsName)
    const stub = doBinding.ns.get(id)

    // Forward request to DO
    const doRequest = new Request(doUrl.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
    })

    const response = await stub.fetch(doRequest)

    // Add routing headers to response
    addRoutingHeaders(response.headers, {
      timestamp: Date.now(),
      requestId,
      pathname: url.pathname,
      method: c.req.method,
      targetBinding: targetBindingName,
      consistencyMode: 'eventual',
      isReplica: doBinding.isReplica ?? false,
      replicaRegion: doBinding.replicaRegion,
      colo: location?.colo,
      region: location?.region,
      routingDurationMs: 0, // Timing measured by the span
    })

    return response
  } catch (error) {
    // Log routing error
    routingSpan.end({
      targetBinding: 'error',
      consistencyMode: 'unknown',
      isReplica: false,
    })
    throw error
  }
})

// Forward all other routes directly to DO
app.all('*', async (c) => {
  const env = c.env
  const url = new URL(c.req.url)
  const requestId = c.req.header('X-Request-ID') || crypto.randomUUID()

  // Start routing telemetry span
  const routingSpan = createRoutingSpan(requestId, url.pathname, c.req.method)

  try {
    // Extract location info from CF headers (if available)
    const location = extractLocationFromHeaders(c.req)

    // Get appropriate DO binding based on route
    const doBinding = await getDOBinding(
      env,
      url.pathname,
      url.hostname,
      c.req.method,
      location
    )
    if (!doBinding) {
      // Log routing failure
      routingSpan.end({
        targetBinding: 'none',
        consistencyMode: 'unknown',
        isReplica: false,
      })
      return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'DO binding not available' } }, 503)
    }

    // Log successful routing decision
    const targetBindingName = doBinding.ns === env.DO ? 'DO' :
                             doBinding.ns === env.REPLICA_DO ? 'REPLICA_DO' :
                             doBinding.ns === env.BROWSER_DO ? 'BROWSER_DO' :
                             doBinding.ns === env.SANDBOX_DO ? 'SANDBOX_DO' :
                             doBinding.ns === env.COLLECTION_DO ? 'COLLECTION_DO' :
                             'DO'

    routingSpan.end({
      targetBinding: targetBindingName,
      consistencyMode: 'eventual',
      isReplica: doBinding.isReplica ?? false,
      replicaRegion: doBinding.replicaRegion,
      nounName: url.pathname.split('/')[1],
      colo: location?.colo,
      region: location?.region,
      lat: location?.lat,
      lon: location?.lon,
    })

    const id = doBinding.ns.idFromName(doBinding.nsName)
    const stub = doBinding.ns.get(id)

    const response = await stub.fetch(c.req.raw)

    // Add routing headers to response
    addRoutingHeaders(response.headers, {
      timestamp: Date.now(),
      requestId,
      pathname: url.pathname,
      method: c.req.method,
      targetBinding: targetBindingName,
      consistencyMode: 'eventual',
      isReplica: doBinding.isReplica ?? false,
      replicaRegion: doBinding.replicaRegion,
      colo: location?.colo,
      region: location?.region,
      routingDurationMs: 0, // Timing measured by the span
    })

    return response
  } catch (error) {
    // Log routing error
    routingSpan.end({
      targetBinding: 'error',
      consistencyMode: 'unknown',
      isReplica: false,
    })
    throw error
  }
})

// ============================================================================
// WORKER DEFAULT EXPORT
// ============================================================================

/**
 * Cloudflare Worker - Default export
 *
 * In production, requests go directly to DO via this handler.
 * The Hono app above is primarily for testing.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Use the Hono app for all requests
    // This ensures consistent behavior between production and tests
    return app.fetch(request, env)
  },
}
