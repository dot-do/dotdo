/**
 * TenantDO - Durable Object for Per-Tenant CRM Data
 *
 * Each tenant (e.g., "acme", "bigcorp") gets their own isolated TenantDO
 * instance with:
 * - SQLite storage for things, relationships, and events
 * - Event routing to parent DO (example.com.ai)
 * - Tenant-specific context ($Context)
 *
 * @module examples/crm.example.com.ai/src/TenantDO
 */

import { DurableObject } from 'cloudflare:workers'
import { $Context, type TenantContext } from './context'

/**
 * Environment bindings available to the DO
 */
interface TenantEnv {
  /** Service binding to parent DO */
  PARENT_DO_SERVICE?: Fetcher

  /** KV namespace for caching */
  TENANT_CACHE?: KVNamespace

  /** R2 bucket for blob storage */
  TENANT_STORAGE?: R2Bucket

  /** Parent domain */
  PARENT_DOMAIN?: string
}

/**
 * TenantDO - Per-tenant Durable Object
 *
 * Handles all requests for a specific tenant's CRM data.
 */
export class TenantDO extends DurableObject<TenantEnv> {
  /** Tenant context (lazy-initialized) */
  private $?: TenantContext

  /** Tenant ID extracted from headers */
  private tenantId?: string

  constructor(state: DurableObjectState, env: TenantEnv) {
    super(state, env)
  }

  /**
   * Get or create the tenant context
   */
  private getContext(tenantId: string, originalUrl: string): TenantContext {
    if (!this.$ || this.tenantId !== tenantId) {
      this.tenantId = tenantId
      this.$ = $Context(originalUrl)
    }
    return this.$
  }

  /**
   * Handle HTTP requests to this tenant DO
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const tenantId = request.headers.get('X-Tenant-Id') || 'unknown'
    const originalUrl = request.headers.get('X-Original-Url') || request.url

    // Initialize tenant context
    const $ = this.getContext(tenantId, originalUrl)

    // Route based on path
    const path = url.pathname

    try {
      // Root path - tenant info
      if (path === '/' || path === '') {
        return this.handleRoot($, tenantId)
      }

      // Things CRUD
      if (path === '/things' || path.startsWith('/things/')) {
        return this.handleThings(request, $, path)
      }

      // Relationships
      if (path === '/relationships' || path.startsWith('/relationships/')) {
        return this.handleRelationships(request, $, path)
      }

      // Events
      if (path === '/events' || path.startsWith('/events/')) {
        return this.handleEvents(request, $, path)
      }

      // Unknown path
      return this.jsonResponse(
        {
          error: 'Not Found',
          path,
          availableEndpoints: ['/things', '/relationships', '/events'],
        },
        404
      )
    } catch (error) {
      console.error(`[TenantDO:${tenantId}] Error handling ${path}:`, error)
      return this.jsonResponse(
        {
          error: error instanceof Error ? error.message : 'Internal Server Error',
          path,
        },
        500
      )
    }
  }

  /**
   * Handle root path - return tenant info
   */
  private handleRoot($: TenantContext, tenantId: string): Response {
    return this.jsonResponse({
      $id: $.$id,
      $type: $.$type,
      $colo: $.$colo,
      tenantId,
      _links: {
        self: $.$id,
        things: `${$.$id}/things`,
        relationships: `${$.$id}/relationships`,
        events: `${$.$id}/events`,
        parent: $.$context.$id,
      },
    })
  }

  /**
   * Handle things CRUD operations
   */
  private async handleThings(
    request: Request,
    $: TenantContext,
    path: string
  ): Promise<Response> {
    const method = request.method
    const thingId = path.replace('/things/', '').replace('/things', '') || undefined

    switch (method) {
      case 'GET': {
        if (thingId) {
          const thing = await $.things.get(thingId)
          if (!thing) {
            return this.jsonResponse({ error: 'Thing not found', id: thingId }, 404)
          }
          return this.jsonResponse(thing)
        }
        // List things
        const url = new URL(request.url)
        const type = url.searchParams.get('$type') || undefined
        const limit = parseInt(url.searchParams.get('limit') || '100', 10)
        const offset = parseInt(url.searchParams.get('offset') || '0', 10)
        const things = await $.things.list({ $type: type, limit, offset })
        return this.jsonResponse({ items: things, count: things.length, limit, offset })
      }

      case 'POST': {
        const body = await request.json() as Record<string, unknown>
        if (!body.$type) {
          return this.jsonResponse({ error: 'Missing required field: $type' }, 400)
        }
        const thing = await $.things.create(body as { $type: string; [key: string]: unknown })
        // Emit creation event
        await $.emit({ $type: `${body.$type}.created`, payload: { thingId: thing.$id } })
        return this.jsonResponse(thing, 201)
      }

      case 'PUT':
      case 'PATCH': {
        if (!thingId) {
          return this.jsonResponse({ error: 'Thing ID required for update' }, 400)
        }
        const body = await request.json() as Record<string, unknown>
        const thing = await $.things.update(thingId, body)
        // Emit update event
        await $.emit({ $type: 'Thing.updated', payload: { thingId: thing.$id } })
        return this.jsonResponse(thing)
      }

      case 'DELETE': {
        if (!thingId) {
          return this.jsonResponse({ error: 'Thing ID required for delete' }, 400)
        }
        const deleted = await $.things.delete(thingId)
        if (!deleted) {
          return this.jsonResponse({ error: 'Thing not found', id: thingId }, 404)
        }
        // Emit deletion event
        await $.emit({ $type: 'Thing.deleted', payload: { thingId } })
        return this.jsonResponse({ deleted: true, id: thingId })
      }

      default:
        return this.jsonResponse({ error: 'Method not allowed' }, 405)
    }
  }

  /**
   * Handle relationships operations
   */
  private async handleRelationships(
    request: Request,
    $: TenantContext,
    path: string
  ): Promise<Response> {
    const method = request.method
    const relId = path.replace('/relationships/', '').replace('/relationships', '') || undefined

    switch (method) {
      case 'GET': {
        if (relId) {
          const rel = await $.relationships.get(relId)
          if (!rel) {
            return this.jsonResponse({ error: 'Relationship not found', id: relId }, 404)
          }
          return this.jsonResponse(rel)
        }
        // List relationships
        const url = new URL(request.url)
        const from = url.searchParams.get('from') || undefined
        const to = url.searchParams.get('to') || undefined
        const type = url.searchParams.get('type') || undefined
        const relationships = await $.relationships.list({ from, to, type })
        return this.jsonResponse({ items: relationships, count: relationships.length })
      }

      case 'POST': {
        const body = await request.json() as Record<string, unknown>
        if (!body.from || !body.to || !body.type) {
          return this.jsonResponse(
            { error: 'Missing required fields: from, to, type' },
            400
          )
        }
        const rel = await $.relationships.create(body as { from: string; to: string; type: string })
        // Emit creation event
        await $.emit({ $type: 'Relationship.created', payload: { relationshipId: rel.$id } })
        return this.jsonResponse(rel, 201)
      }

      case 'DELETE': {
        if (!relId) {
          return this.jsonResponse({ error: 'Relationship ID required for delete' }, 400)
        }
        const deleted = await $.relationships.delete(relId)
        if (!deleted) {
          return this.jsonResponse({ error: 'Relationship not found', id: relId }, 404)
        }
        // Emit deletion event
        await $.emit({ $type: 'Relationship.deleted', payload: { relationshipId: relId } })
        return this.jsonResponse({ deleted: true, id: relId })
      }

      default:
        return this.jsonResponse({ error: 'Method not allowed' }, 405)
    }
  }

  /**
   * Handle events operations
   */
  private async handleEvents(
    request: Request,
    $: TenantContext,
    path: string
  ): Promise<Response> {
    const method = request.method
    const eventId = path.replace('/events/', '').replace('/events', '') || undefined

    switch (method) {
      case 'GET': {
        if (eventId) {
          const event = await $.events.get(eventId)
          if (!event) {
            return this.jsonResponse({ error: 'Event not found', id: eventId }, 404)
          }
          return this.jsonResponse(event)
        }
        // List events
        const url = new URL(request.url)
        const type = url.searchParams.get('$type') || undefined
        const limit = parseInt(url.searchParams.get('limit') || '100', 10)
        const events = await $.events.list({ $type: type, limit })
        return this.jsonResponse({ items: events, count: events.length, limit })
      }

      case 'POST': {
        const body = await request.json() as Record<string, unknown>
        if (!body.$type || !body.payload) {
          return this.jsonResponse(
            { error: 'Missing required fields: $type, payload' },
            400
          )
        }
        const event = await $.events.create({
          $type: body.$type as string,
          payload: body.payload as Record<string, unknown>,
        })
        return this.jsonResponse(event, 201)
      }

      default:
        return this.jsonResponse({ error: 'Method not allowed' }, 405)
    }
  }

  /**
   * Helper to create JSON responses
   */
  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    })
  }
}
