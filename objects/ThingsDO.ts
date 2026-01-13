/**
 * ThingsDO - Durable Object for storing Things
 *
 * This DO provides persistent storage for Things, accessible via HTTP fetch.
 * The API routes delegate CRUD operations to this DO via the env.DO binding.
 *
 * Routes:
 * - GET /things - List all things
 * - POST /things - Create a thing
 * - GET /things/:id - Get a specific thing
 * - PUT /things/:id - Update a thing
 * - DELETE /things/:id - Delete a thing
 * - GET /:type/:id/edit - Edit UI with Monaco editor
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import { generateEditUI, createEditUIData } from './transport/edit-ui'

export interface ThingData {
  id: string
  $id: string
  $type: string
  name: string
  data?: Record<string, unknown>
  relationships?: Array<{ type: string; targetId: string }>
  createdAt: string
  updatedAt: string
}

interface StoredThing {
  id: string
  $type: string
  name: string
  data?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export class ThingsDO extends DurableObject {
  private app: Hono

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env)
    this.app = this.createApp()
  }

  private createApp(): Hono {
    const app = new Hono()

    // List all things
    app.get('/things', async (c) => {
      const limitParam = c.req.query('limit')
      const offsetParam = c.req.query('offset')

      const limit = limitParam ? parseInt(limitParam, 10) : 100
      const offset = offsetParam ? parseInt(offsetParam, 10) : 0

      if (isNaN(limit) || limit < 0) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid limit parameter' } }, 400)
      }
      if (isNaN(offset) || offset < 0) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid offset parameter' } }, 400)
      }

      const thingsMap = await this.ctx.storage.get<Map<string, StoredThing>>('things')
      const things = thingsMap ? Array.from(thingsMap.values()) : []

      // Convert to API format with $id and relationships
      const result = things.slice(offset, offset + limit).map((t) => this.toApiFormat(t))

      return c.json(result)
    })

    // Create a thing
    app.post('/things', async (c) => {
      const contentType = c.req.header('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Content-Type must be application/json' } }, 400)
      }

      let body: { name?: string; $type?: string; data?: Record<string, unknown> }

      try {
        const text = await c.req.text()
        if (!text || text.trim() === '') {
          return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body cannot be empty' } }, 400)
        }
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } }, 400)
        }
        body = parsed
      } catch {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
      }

      // Validate name
      if (!body.name || typeof body.name !== 'string') {
        return c.json(
          {
            error: {
              code: 'UNPROCESSABLE_ENTITY',
              message: 'Validation failed: missing required field name',
              details: { name: ['Name is required'] },
            },
          },
          422,
        )
      }

      if (body.name === '') {
        return c.json(
          {
            error: {
              code: 'UNPROCESSABLE_ENTITY',
              message: 'Validation failed: name is required',
              details: { name: ['Name is required'] },
            },
          },
          422,
        )
      }

      const id = crypto.randomUUID()
      const now = new Date().toISOString()

      const thing: StoredThing = {
        id,
        $type: body.$type || 'thing',
        name: body.name,
        data: body.data,
        createdAt: now,
        updatedAt: now,
      }

      // Store in DO storage
      const thingsMap = (await this.ctx.storage.get<Map<string, StoredThing>>('things')) || new Map()
      thingsMap.set(id, thing)
      await this.ctx.storage.put('things', thingsMap)

      return c.json(this.toApiFormat(thing), 201)
    })

    // Get a specific thing
    app.get('/things/:id', async (c) => {
      const id = c.req.param('id')
      const thingsMap = await this.ctx.storage.get<Map<string, StoredThing>>('things')
      const thing = thingsMap?.get(id)

      if (!thing) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
      }

      return c.json(this.toApiFormat(thing))
    })

    // Update a thing
    app.put('/things/:id', async (c) => {
      const id = c.req.param('id')
      const thingsMap = await this.ctx.storage.get<Map<string, StoredThing>>('things')
      const existing = thingsMap?.get(id)

      if (!existing) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
      }

      let body: { name?: string; data?: Record<string, unknown> }

      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
      }

      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid update data' } }, 400)
      }

      const updated: StoredThing = {
        ...existing,
        name: body.name ?? existing.name,
        data: body.data ?? existing.data,
        updatedAt: new Date().toISOString(),
      }

      thingsMap!.set(id, updated)
      await this.ctx.storage.put('things', thingsMap)

      return c.json(this.toApiFormat(updated))
    })

    // Delete a thing
    app.delete('/things/:id', async (c) => {
      const id = c.req.param('id')
      const thingsMap = await this.ctx.storage.get<Map<string, StoredThing>>('things')

      if (!thingsMap?.has(id)) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
      }

      thingsMap.delete(id)
      await this.ctx.storage.put('things', thingsMap)

      return new Response(null, { status: 204 })
    })

    // ========================================================================
    // REST-style routes: /:type, /:type/:id, /:type/:id/edit
    // These provide a RESTful interface for any resource type
    // ========================================================================

    // Edit UI: GET /:type/:id/edit
    app.get('/:type/:id/edit', async (c) => {
      const type = c.req.param('type')
      const id = c.req.param('id')
      const url = new URL(c.req.url)
      const ns = url.origin

      // Try to get existing thing by ID
      const thingsMap = await this.ctx.storage.get<Map<string, StoredThing>>('things')
      let existingData: Record<string, unknown> | null = null

      if (thingsMap) {
        // Try to find by exact id
        const thing = thingsMap.get(id)
        if (thing) {
          existingData = {
            id: thing.id,
            name: thing.name,
            ...(thing.data ?? {}),
          }
        } else {
          // Try to find by searching all things
          for (const [thingId, thing] of thingsMap.entries()) {
            if (thingId === id || thing.name?.toLowerCase() === id.toLowerCase()) {
              existingData = {
                id: thing.id,
                name: thing.name,
                ...(thing.data ?? {}),
              }
              break
            }
          }
        }
      }

      // Generate edit UI data
      const editData = createEditUIData(ns, type, id, existingData)
      const html = generateEditUI(editData)

      return c.html(html)
    })

    // List collection: GET /:type
    app.get('/:type', async (c) => {
      const type = c.req.param('type')
      const url = new URL(c.req.url)
      const ns = url.origin

      const thingsMap = await this.ctx.storage.get<Map<string, StoredThing>>('things')
      const things = thingsMap ? Array.from(thingsMap.values()) : []

      // Filter by type if needed (singularize the type for matching)
      const singularType = this.singularize(type)
      const filtered = things.filter(t =>
        t.$type.toLowerCase() === singularType.toLowerCase() ||
        t.$type.toLowerCase() === type.toLowerCase()
      )

      // Build collection response
      const items = filtered.map(t => ({
        $context: ns,
        $type: `${ns}/${singularType}`,
        $id: `${ns}/${type}/${t.id}`,
        id: t.id,
        name: t.name,
        ...(t.data ?? {}),
      }))

      return c.json({
        $context: ns,
        $type: 'Collection',
        $id: `${ns}/${type}`,
        items,
        total: items.length,
      })
    })

    // Get item: GET /:type/:id
    app.get('/:type/:id', async (c) => {
      const type = c.req.param('type')
      const id = c.req.param('id')
      const url = new URL(c.req.url)
      const ns = url.origin

      const thingsMap = await this.ctx.storage.get<Map<string, StoredThing>>('things')
      let thing: StoredThing | undefined

      if (thingsMap) {
        // Try to find by exact id first
        thing = thingsMap.get(id)
        if (!thing) {
          // Try to find by name
          for (const t of thingsMap.values()) {
            if (t.name?.toLowerCase() === id.toLowerCase()) {
              thing = t
              break
            }
          }
        }
      }

      if (!thing) {
        // Return a minimal structure for non-existent items
        // This allows the edit UI to work for creating new items
        const singularType = this.singularize(type)
        return c.json({
          $context: ns,
          $type: `${ns}/${singularType}`,
          $id: `${ns}/${type}/${id}`,
          id: id,
          links: {
            self: `${ns}/${type}/${id}`,
            collection: `${ns}/${type}`,
            edit: `${ns}/${type}/${id}/edit`,
          },
        })
      }

      const singularType = this.singularize(type)
      return c.json({
        $context: ns,
        $type: `${ns}/${singularType}`,
        $id: `${ns}/${type}/${thing.id}`,
        id: thing.id,
        name: thing.name,
        ...(thing.data ?? {}),
        links: {
          self: `${ns}/${type}/${thing.id}`,
          collection: `${ns}/${type}`,
          edit: `${ns}/${type}/${thing.id}/edit`,
        },
      })
    })

    // Create item: POST /:type
    app.post('/:type', async (c) => {
      const type = c.req.param('type')
      const url = new URL(c.req.url)
      const ns = url.origin

      let body: Record<string, unknown>
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
      }

      const id = (body.id as string) || (body.$id as string) || crypto.randomUUID()
      const now = new Date().toISOString()
      const singularType = this.singularize(type)

      const thing: StoredThing = {
        id,
        $type: singularType,
        name: (body.name as string) || id,
        data: body,
        createdAt: now,
        updatedAt: now,
      }

      const thingsMap = (await this.ctx.storage.get<Map<string, StoredThing>>('things')) || new Map()
      thingsMap.set(id, thing)
      await this.ctx.storage.put('things', thingsMap)

      return c.json({
        $context: ns,
        $type: `${ns}/${singularType}`,
        $id: `${ns}/${type}/${id}`,
        id,
        name: thing.name,
        ...(thing.data ?? {}),
      }, 201)
    })

    // Update item: PUT /:type/:id
    app.put('/:type/:id', async (c) => {
      const type = c.req.param('type')
      const id = c.req.param('id')
      const url = new URL(c.req.url)
      const ns = url.origin

      let body: Record<string, unknown>
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
      }

      const now = new Date().toISOString()
      const singularType = this.singularize(type)

      const thingsMap = (await this.ctx.storage.get<Map<string, StoredThing>>('things')) || new Map()

      // Get existing or create new
      const existing = thingsMap.get(id)
      const thing: StoredThing = {
        id,
        $type: singularType,
        name: (body.name as string) || existing?.name || id,
        data: body,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      }

      thingsMap.set(id, thing)
      await this.ctx.storage.put('things', thingsMap)

      return c.json({
        $context: ns,
        $type: `${ns}/${singularType}`,
        $id: `${ns}/${type}/${id}`,
        id,
        name: thing.name,
        ...(thing.data ?? {}),
        success: true,
      })
    })

    // Delete item: DELETE /:type/:id
    app.delete('/:type/:id', async (c) => {
      const type = c.req.param('type')
      const id = c.req.param('id')

      const thingsMap = await this.ctx.storage.get<Map<string, StoredThing>>('things')

      if (!thingsMap?.has(id)) {
        return c.json({ error: { code: 'NOT_FOUND', message: `${type} not found: ${id}` } }, 404)
      }

      thingsMap.delete(id)
      await this.ctx.storage.put('things', thingsMap)

      return new Response(null, { status: 204 })
    })

    // Catch-all
    app.all('*', (c) => {
      return c.json({ error: { code: 'NOT_FOUND', message: `Not found: ${c.req.path}` } }, 404)
    })

    return app
  }

  /**
   * Convert plural form to singular (simple heuristic)
   */
  private singularize(plural: string): string {
    let singular = plural

    if (plural.endsWith('ies')) {
      singular = plural.slice(0, -3) + 'y'
    } else if (plural.endsWith('es')) {
      singular = plural.slice(0, -2)
    } else if (plural.endsWith('s')) {
      singular = plural.slice(0, -1)
    }

    // Capitalize first letter
    return singular.charAt(0).toUpperCase() + singular.slice(1)
  }

  private toApiFormat(thing: StoredThing): ThingData {
    return {
      id: thing.id,
      $id: `thing:${thing.id}`,
      $type: thing.$type,
      name: thing.name,
      data: thing.data,
      relationships: [], // Empty by default, could be populated from relationships store
      createdAt: thing.createdAt,
      updatedAt: thing.updatedAt,
    }
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}

export default ThingsDO
