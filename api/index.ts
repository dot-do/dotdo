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

export { DO } from '../objects/DO'

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

const DO_ROUTES: Record<string, DORoute> = {
  'test-collection': { binding: 'COLLECTION_DO', nsStrategy: 'singleton' },
  'browsers': { binding: 'BROWSER_DO', nsStrategy: 'tenant' },
  'sandboxes': { binding: 'SANDBOX_DO', nsStrategy: 'tenant' },
  'obs': { binding: 'OBS_BROADCASTER', nsStrategy: 'singleton' },
}

/**
 * Get DO binding and namespace for a request
 *
 * @param env - Cloudflare env with DO bindings
 * @param pathname - Request pathname
 * @param hostname - Request hostname for tenant derivation
 * @returns DO namespace binding and namespace string
 */
function getDOBinding(
  env: Env,
  pathname: string,
  hostname: string
): { ns: DurableObjectNamespace; nsName: string } | null {
  // Extract first path segment (e.g., '/browsers/123' → 'browsers')
  const segments = pathname.slice(1).split('/')
  const firstSegment = segments[0]?.toLowerCase() ?? ''

  // Check for special routes
  const route = DO_ROUTES[firstSegment]

  if (route) {
    const binding = env[route.binding]
    if (!binding) {
      return null // Binding not available
    }

    let nsName: string
    switch (route.nsStrategy) {
      case 'singleton':
        nsName = firstSegment
        break
      case 'sharded':
        // Hash the ID to determine shard
        const id = segments[1] ?? ''
        const shardCount = route.shardCount ?? 16
        const hash = simpleHash(id)
        nsName = `${firstSegment}-shard-${hash % shardCount}`
        break
      case 'tenant':
      default:
        nsName = getTenantFromHostname(hostname)
        break
    }

    return { ns: binding, nsName }
  }

  // Default: use main DO binding with tenant namespace
  if (!env.DO) {
    return null
  }

  return {
    ns: env.DO,
    nsName: getTenantFromHostname(hostname),
  }
}

/**
 * Extract tenant from hostname
 *
 * Examples:
 * - acme.api.dotdo.dev → 'acme'
 * - localhost:8787 → 'default'
 * - api.dotdo.dev → 'default'
 */
function getTenantFromHostname(hostname: string): string {
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

// Legacy function for backward compatibility
function getNamespace(url: URL): string {
  return getTenantFromHostname(url.hostname)
}

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
 * POST /query - Execute scatter-gather query across sharded DOs
 *
 * Request body:
 * {
 *   collection: string,      // Collection to query
 *   filter?: object,         // Filter criteria
 *   sort?: { field: string, order: 'asc' | 'desc' },
 *   limit?: number,          // Default: 100
 *   offset?: number,         // Default: 0
 * }
 *
 * Response:
 * {
 *   results: array,          // Merged results from all shards
 *   meta: {
 *     total: number,         // Total matching items
 *     shards: number,        // Number of shards queried
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

  // For now, use default DO binding for queries
  // In the future, this can be configured per-collection
  if (!env.DO) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'DO binding not available' } }, 503)
  }

  // Build the query URL for the DO
  const collection = body.collection ?? 'things'
  const queryParams = new URLSearchParams()
  if (body.filter) queryParams.set('filter', JSON.stringify(body.filter))
  if (body.sort) queryParams.set('sort', `${body.sort.field}:${body.sort.order}`)
  if (body.limit) queryParams.set('limit', String(body.limit))
  if (body.offset) queryParams.set('offset', String(body.offset))

  const queryUrl = `/${collection}?${queryParams.toString()}`
  const queryRequest = new Request(new URL(queryUrl, url.origin).toString(), {
    method: 'GET',
    headers: c.req.raw.headers,
  })

  // Check if this collection has a sharded configuration
  const shardConfig = body.shardConfig
  if (shardConfig) {
    // Use scatter-gather for sharded collections
    const binding = env[shardConfig.binding as keyof Env] as DurableObjectNamespace | undefined
    if (!binding) {
      return c.json({ error: { code: 'INVALID_CONFIG', message: `Unknown binding: ${shardConfig.binding}` } }, 400)
    }

    const { results, errors } = await scatterGather(queryRequest, {
      binding,
      shardCount: shardConfig.count,
      shardPrefix: shardConfig.prefix,
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
        shards: shardConfig.count,
        errors: errors.length > 0 ? errors : undefined,
      },
    })
  }

  // Single DO query (non-sharded)
  const id = env.DO.idFromName(tenant)
  const stub = env.DO.get(id)
  const response = await stub.fetch(queryRequest)

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

  // Strip /api prefix for DO routing
  const pathWithoutApi = url.pathname.replace(/^\/api/, '') || '/'

  // Get appropriate DO binding based on route
  const doBinding = getDOBinding(env, pathWithoutApi, url.hostname)
  if (!doBinding) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'DO binding not available' } }, 503)
  }

  const doUrl = new URL(pathWithoutApi + url.search, url.origin)

  const id = doBinding.ns.idFromName(doBinding.nsName)
  const stub = doBinding.ns.get(id)

  // Forward request to DO
  const doRequest = new Request(doUrl.toString(), {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
  })

  return stub.fetch(doRequest)
})

// Forward all other routes directly to DO
app.all('*', async (c) => {
  const env = c.env
  const url = new URL(c.req.url)

  // Get appropriate DO binding based on route
  const doBinding = getDOBinding(env, url.pathname, url.hostname)
  if (!doBinding) {
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'DO binding not available' } }, 503)
  }

  const id = doBinding.ns.idFromName(doBinding.nsName)
  const stub = doBinding.ns.get(id)

  return stub.fetch(c.req.raw)
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
