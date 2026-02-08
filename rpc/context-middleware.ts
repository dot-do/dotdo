/**
 * Hono Middleware for $Context Extraction (do-99vxp)
 *
 * Extracts a typed, immutable $Context from incoming Hono requests and makes
 * it available via `c.get('$context')` for all downstream handlers.
 *
 * Context sources (in priority order):
 * 1. Propagated headers from upstream RPC/Worker calls
 * 2. Auth token (JWT sub -> userId)
 * 3. URL-based tenant extraction (subdomain or path)
 * 4. Request metadata (IP, User-Agent, Cloudflare headers)
 *
 * @module rpc/context-middleware
 */

import type { MiddlewareHandler, Context } from 'hono'
import {
  createContext,
  createAnonymousContext,
  contextFromHeaders,
  type $Context,
  type PermissionLevel,
  type RequestMeta,
  CONTEXT_HEADERS,
} from './context'
import { CORRELATION_ID_HEADER } from './headers'

// ============================================================================
// Hono Variable Types
// ============================================================================

/**
 * Declare the variables that this middleware sets on the Hono context.
 *
 * Usage in your Hono app:
 * ```typescript
 * type Env = { Variables: ContextVariables }
 * const app = new Hono<Env>()
 * app.use('/*', contextMiddleware({ ... }))
 * app.get('/', (c) => {
 *   const $ctx = c.get('$context')
 *   return c.json({ tenant: $ctx.tenantId })
 * })
 * ```
 */
export interface ContextVariables {
  $context: $Context
}

// ============================================================================
// Middleware Options
// ============================================================================

/**
 * Options for the context middleware.
 */
export interface ContextMiddlewareOptions {
  /**
   * Extract tenant ID from the request.
   * Default: extracts from subdomain (first part of hostname if >2 parts)
   * or from first path segment.
   *
   * @param c - The Hono context
   * @returns The tenant ID or undefined
   */
  extractTenant?: (c: Context) => string | undefined

  /**
   * Extract user ID from the request (e.g., from JWT).
   * If not provided, userId will come from propagated headers only.
   *
   * @param c - The Hono context
   * @returns The user ID or undefined
   */
  extractUserId?: (c: Context) => string | undefined

  /**
   * Extract agent ID from the request.
   * If not provided, agentId will come from propagated headers only.
   *
   * @param c - The Hono context
   * @returns The agent ID or undefined
   */
  extractAgentId?: (c: Context) => string | undefined

  /**
   * Extract permissions from the request.
   * Default: empty array (no permissions)
   *
   * @param c - The Hono context
   * @returns Permission levels
   */
  extractPermissions?: (c: Context) => PermissionLevel[]

  /**
   * Default tenant ID to use when none can be extracted.
   * If not provided and no tenant can be extracted, the middleware
   * will use 'default' as the tenant ID.
   */
  defaultTenant?: string

  /**
   * Whether to trust propagated context headers.
   * Set to false in edge/public-facing workers to prevent context injection.
   * Default: true (for DO-to-DO communication)
   */
  trustPropagatedHeaders?: boolean
}

// ============================================================================
// Default Extractors
// ============================================================================

/**
 * Default tenant extractor: subdomain or first path segment.
 */
function defaultExtractTenant(c: Context): string | undefined {
  const url = new URL(c.req.url)
  const hostParts = url.hostname.split('.')

  // Subdomain-based: crm.headless.ly -> 'crm'
  if (hostParts.length > 2) {
    return hostParts[0]
  }

  // Path-based: headless.ly/~acme -> 'acme'
  const path = url.pathname
  const tildaMatch = path.match(/^\/~([^/]+)/)
  if (tildaMatch) {
    return tildaMatch[1]
  }

  // First path segment: headless.ly/acme/... -> 'acme'
  const segments = path.split('/').filter(Boolean)
  if (segments.length > 0) {
    return segments[0]
  }

  return undefined
}

/**
 * Extract request metadata from a Hono context.
 */
function extractRequestMeta(c: Context): RequestMeta {
  const cf = (c.req.raw as Request & { cf?: { colo?: string; country?: string } }).cf
  return {
    ip: c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim(),
    userAgent: c.req.header('User-Agent') ?? undefined,
    origin: c.req.header('Origin') ?? undefined,
    colo: cf?.colo,
    timestamp: new Date().toISOString(),
    country: cf?.country ?? c.req.header('CF-IPCountry') ?? undefined,
  }
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Create a Hono middleware that extracts and attaches a $Context to every request.
 *
 * The context is frozen (immutable) and available via `c.get('$context')`.
 *
 * @param options - Middleware configuration
 * @returns Hono middleware handler
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono'
 * import { contextMiddleware, type ContextVariables } from '@dotdo/rpc'
 *
 * type Env = { Variables: ContextVariables }
 * const app = new Hono<Env>()
 *
 * app.use('/*', contextMiddleware({
 *   extractUserId: (c) => c.get('jwtPayload')?.sub,
 *   defaultTenant: 'default',
 * }))
 *
 * app.get('/api/whoami', (c) => {
 *   const $ctx = c.get('$context')
 *   return c.json({
 *     tenant: $ctx.tenantId,
 *     user: $ctx.userId,
 *     correlationId: $ctx.correlationId,
 *   })
 * })
 * ```
 */
export function contextMiddleware(options: ContextMiddlewareOptions = {}): MiddlewareHandler {
  const {
    extractTenant = defaultExtractTenant,
    extractUserId,
    extractAgentId,
    extractPermissions,
    defaultTenant = 'default',
    trustPropagatedHeaders = true,
  } = options

  return async (c, next) => {
    let $ctx: $Context

    // First, check if context was propagated via headers (from upstream RPC/Worker)
    if (trustPropagatedHeaders) {
      const propagated = contextFromHeaders(c.req.raw.headers)
      if (propagated) {
        // Use the propagated context, enriching with request metadata
        $ctx = createContext({
          correlationId: propagated.correlationId,
          tenantId: propagated.tenantId,
          userId: propagated.userId ?? extractUserId?.(c),
          agentId: propagated.agentId ?? extractAgentId?.(c),
          sessionId: propagated.sessionId,
          permissions: [...propagated.permissions] as PermissionLevel[],
          capabilities: [...propagated.capabilities],
          trusted: propagated.trusted,
          sourceDoId: propagated.sourceDoId,
          request: extractRequestMeta(c),
        })
        c.set('$context' as never, $ctx as never)
        await next()
        return
      }
    }

    // No propagated context — build from scratch
    const tenantId = extractTenant(c) ?? defaultTenant
    const requestMeta = extractRequestMeta(c)
    const correlationId = c.req.header(CORRELATION_ID_HEADER) ?? undefined
    const userId = extractUserId?.(c)
    const agentId = extractAgentId?.(c)
    const permissions = extractPermissions?.(c) ?? []

    $ctx = createContext({
      correlationId,
      tenantId,
      userId,
      agentId,
      permissions,
      capabilities: [],
      trusted: false,
      request: requestMeta,
    })

    c.set('$context' as never, $ctx as never)
    await next()
  }
}

/**
 * Get the $Context from a Hono context.
 * Convenience function that throws if context is not set.
 *
 * @param c - The Hono context
 * @returns The $Context
 * @throws Error if $Context middleware has not been applied
 */
export function getContext(c: Context): $Context {
  const ctx = c.get('$context' as never) as $Context | undefined
  if (!ctx) {
    throw new Error(
      '$Context not found. Ensure contextMiddleware() is applied before this handler.'
    )
  }
  return ctx
}
