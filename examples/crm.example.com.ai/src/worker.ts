/**
 * CRM Tenant DO Worker Entry Point
 *
 * This worker handles requests to crm.example.com.ai/* and routes them
 * to the appropriate TenantDO instance based on the URL path.
 *
 * URL structure: crm.example.com.ai/:tenant/:resource
 * Examples:
 *   - crm.example.com.ai/acme/customers → TenantDO('acme'), path=/customers
 *   - crm.example.com.ai/bigcorp/leads → TenantDO('bigcorp'), path=/leads
 *
 * The worker:
 * 1. Extracts tenant ID from the first path segment
 * 2. Strips the tenant from the path before forwarding
 * 3. Adds tenant context headers for the DO
 *
 * @module examples/crm.example.com.ai/src/worker
 */

import { TenantDO } from './TenantDO'

// Re-export the Durable Object class for Wrangler
export { TenantDO }

/**
 * Environment bindings from wrangler.toml
 */
export interface Env {
  /** Tenant Durable Object namespace */
  TENANT_DO: DurableObjectNamespace

  /** Service binding to parent DO */
  PARENT_DO_SERVICE?: Fetcher

  /** KV namespace for tenant metadata caching */
  TENANT_CACHE?: KVNamespace

  /** R2 bucket for tenant blob storage */
  TENANT_STORAGE?: R2Bucket

  /** API name from vars */
  API_NAME?: string

  /** API version from vars */
  API_VERSION?: string

  /** Parent domain from vars */
  PARENT_DOMAIN?: string
}

/**
 * Extract tenant ID and remaining path from URL
 *
 * @param url - The request URL
 * @returns Object with tenantId and remaining path
 * @throws Error if tenant ID is missing or invalid
 */
function parseTenantPath(url: URL): { tenantId: string; path: string } {
  // Path should be like /acme/customers or /acme
  const pathSegments = url.pathname.split('/').filter(Boolean)

  if (pathSegments.length === 0) {
    throw new Error('Missing tenant ID in path. Expected: /:tenant or /:tenant/:resource')
  }

  const tenantId = pathSegments[0]

  // Validate tenant ID (alphanumeric, hyphens, underscores)
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(tenantId)) {
    throw new Error(`Invalid tenant ID: ${tenantId}. Must be alphanumeric with hyphens/underscores.`)
  }

  // Reconstruct the path without the tenant segment
  const remainingPath = '/' + pathSegments.slice(1).join('/')

  return { tenantId, path: remainingPath }
}

/**
 * Create an error response with JSON body
 */
function errorResponse(message: string, status: number): Response {
  return new Response(
    JSON.stringify({
      error: message,
      status,
      timestamp: new Date().toISOString(),
    }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-Error': 'true',
      },
    }
  )
}

/**
 * Worker fetch handler
 *
 * Routes requests to the appropriate TenantDO based on URL path.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    // Handle root path with API info
    if (url.pathname === '/' || url.pathname === '') {
      return new Response(
        JSON.stringify({
          name: env.API_NAME || 'CRM Tenant DO',
          version: env.API_VERSION || '1.0.0',
          description: 'Multi-tenant CRM API with Durable Objects',
          endpoints: {
            tenant: '/:tenant - Access tenant-specific resources',
            things: '/:tenant/things - CRUD operations on things',
            relationships: '/:tenant/relationships - Manage relationships',
            events: '/:tenant/events - Event sourcing store',
          },
          _links: {
            self: url.href,
            parent: `https://${env.PARENT_DOMAIN || 'example.com.ai'}`,
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    // Parse tenant ID and path
    let tenantId: string
    let path: string

    try {
      const parsed = parseTenantPath(url)
      tenantId = parsed.tenantId
      path = parsed.path
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : 'Invalid request path',
        400
      )
    }

    // Get or create the TenantDO instance for this tenant
    const doId = env.TENANT_DO.idFromName(tenantId)
    const stub = env.TENANT_DO.get(doId)

    // Reconstruct the URL with the tenant-stripped path
    const doUrl = new URL(path, url.origin)
    doUrl.search = url.search

    // Create a new request with tenant context headers
    const doRequest = new Request(doUrl.toString(), {
      method: request.method,
      headers: new Headers({
        ...Object.fromEntries(request.headers),
        'X-Tenant-Id': tenantId,
        'X-Original-Url': url.href,
        'X-Parent-Domain': env.PARENT_DOMAIN || 'example.com.ai',
      }),
      body: request.body,
      // @ts-expect-error - duplex is needed for streaming bodies but not in all TS definitions
      duplex: request.body ? 'half' : undefined,
    })

    // Forward to the TenantDO
    try {
      const response = await stub.fetch(doRequest)

      // Add tenant context to response headers
      const headers = new Headers(response.headers)
      headers.set('X-Tenant-Id', tenantId)
      headers.set('X-DO-Id', doId.toString())

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (error) {
      console.error(`[TenantDO:${tenantId}] Error:`, error)
      return errorResponse(
        `Failed to process request for tenant ${tenantId}`,
        500
      )
    }
  },
}
