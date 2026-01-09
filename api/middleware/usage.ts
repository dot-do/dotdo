import type { Context, MiddlewareHandler } from 'hono'
import { createUsageEvent, type UsageEvent, type HttpMethod } from '../usage/events'

// ============================================================================
// Types
// ============================================================================

/**
 * Usage context attached to Hono context for downstream handlers
 */
export interface UsageContext {
  /** Start time of request processing */
  startTime: number
  /** Request ID for correlation */
  requestId: string
  /** Endpoint path (normalized) */
  endpoint: string
  /** HTTP method */
  method: string
  /** API key ID if authenticated via API key */
  apiKeyId?: string
  /** User ID if authenticated */
  userId?: string
  /** Request content length */
  requestSize?: number
}

/**
 * Pipeline interface for sending usage events
 */
export interface UsagePipeline {
  send(events: UsageEvent[]): Promise<void>
}

/**
 * Usage middleware configuration options
 */
export interface UsageMiddlewareOptions {
  /** Pipeline to send events to */
  pipeline: UsagePipeline
  /** Endpoints to exclude from tracking */
  excludePaths?: string[]
  /** Whether to track anonymous requests (default: true) */
  trackAnonymous?: boolean
  /** Custom cost calculator function */
  calculateCost?: (ctx: UsageContext, statusCode: number) => number
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return crypto.randomUUID()
}

/**
 * Hash an IP address for privacy
 */
async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(ip)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Extract colo from CF-Ray header (format: rayid-COLO)
 */
function extractColoFromRay(ray: string): string | undefined {
  const parts = ray.split('-')
  return parts.length > 1 ? parts[parts.length - 1] : undefined
}

/**
 * Check if a path matches any of the exclude patterns
 */
function isExcludedPath(path: string, excludePaths: string[]): boolean {
  for (const pattern of excludePaths) {
    // Support glob patterns with *
    if (pattern.includes('*')) {
      const regexPattern = pattern.replace(/\*/g, '.*')
      const regex = new RegExp(`^${regexPattern}$`)
      if (regex.test(path)) {
        return true
      }
    } else if (path === pattern) {
      return true
    }
  }
  return false
}

/**
 * Get the normalized endpoint path from the matched route
 */
function getNormalizedEndpoint(c: Context): string {
  // Try to get the route pattern from the router
  const routePath = c.req.routePath

  // If we have a route pattern, use it
  if (routePath) {
    return routePath
  }

  // Fallback: strip query parameters from the URL path
  const url = new URL(c.req.url)
  return url.pathname
}

/**
 * Default cost calculator - returns 1 for all requests
 */
function defaultCostCalculator(): number {
  return 1
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Usage tracking middleware
 *
 * Captures request/response metrics and emits events to a pipeline:
 * - Latency measurement
 * - Status code tracking
 * - Request/response sizes
 * - API key attribution
 * - Cloudflare metadata (rayId, colo, IP hash)
 *
 * @param options - Middleware configuration
 * @returns Hono middleware handler
 */
export function usageMiddleware(options: UsageMiddlewareOptions): MiddlewareHandler {
  const { pipeline, excludePaths = [], trackAnonymous = true, calculateCost = defaultCostCalculator } = options

  return async (c, next) => {
    // Get the path without query parameters
    const url = new URL(c.req.url)
    const path = url.pathname

    // Check if path is excluded
    if (isExcludedPath(path, excludePaths)) {
      return next()
    }

    // Capture start time
    const startTime = Date.now()
    const requestId = generateRequestId()

    // Get request size from Content-Length header
    const contentLength = c.req.header('Content-Length')
    const requestSize = contentLength ? parseInt(contentLength, 10) : undefined

    // Create usage context
    const usageContext: UsageContext = {
      startTime,
      requestId,
      endpoint: path, // Will be updated to normalized endpoint after routing
      method: c.req.method,
      requestSize,
    }

    // Check for auth context from previous middleware
    const auth = c.get('auth') as { userId?: string; apiKeyId?: string } | undefined
    if (auth) {
      usageContext.userId = auth.userId
      usageContext.apiKeyId = auth.apiKeyId
    }

    // Check for API key from header (if not already set by auth middleware)
    if (!usageContext.apiKeyId) {
      const apiKey = c.req.header('X-API-Key')
      if (apiKey) {
        usageContext.apiKeyId = apiKey
      }
    }

    // Attach usage context to Hono context
    c.set('usage', usageContext)

    // Process the request
    await next()

    // Update endpoint to normalized path after routing
    usageContext.endpoint = getNormalizedEndpoint(c)

    // Check if this is an anonymous request and we should skip tracking
    if (!trackAnonymous && !usageContext.userId && !usageContext.apiKeyId) {
      return
    }

    // Calculate latency
    const latencyMs = Date.now() - startTime

    // Get response size
    const responseSize = c.res.headers.get('Content-Length')
    const responseSizeNum = responseSize ? parseInt(responseSize, 10) : undefined

    // Get Cloudflare metadata
    const cfRay = c.req.header('CF-Ray')
    const userAgent = c.req.header('User-Agent')
    const cfConnectingIp = c.req.header('CF-Connecting-IP')

    // Hash IP for privacy (async but non-blocking)
    let ipHash: string | undefined
    if (cfConnectingIp) {
      try {
        ipHash = await hashIp(cfConnectingIp)
      } catch {
        // Ignore hash errors
      }
    }

    // Extract colo from ray ID
    const colo = cfRay ? extractColoFromRay(cfRay) : undefined

    // Calculate cost
    const cost = calculateCost(usageContext, c.res.status)

    // Create usage event
    const event = createUsageEvent({
      id: requestId,
      timestamp: new Date().toISOString(),
      endpoint: usageContext.endpoint,
      method: usageContext.method as HttpMethod,
      statusCode: c.res.status,
      latencyMs,
      cost,
      userId: usageContext.userId,
      apiKeyId: usageContext.apiKeyId,
      metadata: {
        userAgent: userAgent || undefined,
        ipHash: ipHash || undefined,
        requestSize: requestSize,
        responseSize: responseSizeNum,
        rayId: cfRay || undefined,
        colo: colo || undefined,
      },
    })

    // Emit event to pipeline asynchronously (non-blocking)
    // We don't await this to avoid blocking the response
    pipeline.send([event]).catch(() => {
      // Silently ignore pipeline errors - they shouldn't affect the response
    })
  }
}

export default usageMiddleware
