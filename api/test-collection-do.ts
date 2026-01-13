/**
 * TestCollectionDO - Test Collection Durable Object for E2E tests
 *
 * Implements the Collection<T> pattern with simple storage:
 * - Root IS the collection (not a DO with multiple collections)
 * - Items are at /:id (not /:type/:id)
 * - $type === $id at root level
 * - Proper parent/child context navigation
 *
 * Uses DO storage directly (not Drizzle) for simplicity in E2E tests.
 *
 * @see tests/e2e/clickable-api-collection-do.spec.ts
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'

/**
 * Collection namespace - the identity of this collection
 */
const COLLECTION_NS = 'https://test-collection.local'

/**
 * Schema.org.ai context URL for orphan collections
 */
const COLLECTION_CONTEXT = 'https://schema.org.ai/Collection'

/**
 * Stored item shape
 */
interface StoredItem {
  id: string
  name?: string
  description?: string
  data?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * Collection item response shape (Linked Data format)
 */
interface ItemResponse {
  $context: string
  $type: string
  $id: string
  name?: string
  description?: string
  [key: string]: unknown
}

/**
 * Collection root response shape
 */
interface CollectionResponse {
  $context: string
  $type: string
  $id: string
  items: ItemResponse[]
  count: number
  cursor?: string
}

/**
 * TestCollectionDO - Implements Collection<T> pattern for E2E tests
 */
export class TestCollectionDO extends DurableObject {
  private app: Hono

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    super(ctx, env)
    this.app = this.createApp()
  }

  private createApp(): Hono {
    const app = new Hono()

    // GET / - List all items (collection root)
    app.get('/', async (c) => {
      const limitParam = c.req.query('limit')
      const afterParam = c.req.query('after')

      const limit = limitParam ? parseInt(limitParam, 10) : 100
      if (isNaN(limit) || limit < 0) {
        return c.json({ $type: 'Error', error: 'Invalid limit parameter', code: 'BAD_REQUEST' }, 400)
      }

      // Get all items from storage
      const itemsMap = (await this.ctx.storage.get<Map<string, StoredItem>>('items')) || new Map()
      let items = Array.from(itemsMap.values())

      // Sort by createdAt for consistent ordering
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

      // Apply cursor pagination (after)
      if (afterParam) {
        const afterIndex = items.findIndex((item) => item.id === afterParam)
        if (afterIndex >= 0) {
          items = items.slice(afterIndex + 1)
        }
      }

      // Apply limit
      const paginatedItems = items.slice(0, limit)

      // Format items as linked data
      const itemResponses: ItemResponse[] = paginatedItems.map((item) => this.formatItemResponse(item))

      // Build collection response
      const response: CollectionResponse = {
        $context: COLLECTION_CONTEXT,
        $type: COLLECTION_NS,
        $id: COLLECTION_NS,
        items: itemResponses,
        count: paginatedItems.length,
      }

      // Add cursor if there might be more items
      if (paginatedItems.length === limit && items.length > limit) {
        response.cursor = paginatedItems[paginatedItems.length - 1]!.id
      }

      return c.json(response)
    })

    // POST / - Create a new item
    app.post('/', async (c) => {
      let body: { id?: string; name?: string; description?: string; [key: string]: unknown }

      try {
        const text = await c.req.text()
        if (!text || text.trim() === '') {
          return c.json({ $type: 'Error', error: 'Request body cannot be empty', code: 'BAD_REQUEST' }, 400)
        }
        const parsed = JSON.parse(text)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return c.json({ $type: 'Error', error: 'Request body must be a JSON object', code: 'BAD_REQUEST' }, 400)
        }
        body = parsed
      } catch {
        return c.json({ $type: 'Error', error: 'Invalid JSON body', code: 'BAD_REQUEST' }, 400)
      }

      // Generate ID if not provided
      const id = body.id || this.generateId()

      // Check for duplicate
      const itemsMap = (await this.ctx.storage.get<Map<string, StoredItem>>('items')) || new Map()
      if (itemsMap.has(id)) {
        return c.json({ $type: 'Error', error: `Item '${id}' already exists`, code: 'CONFLICT' }, 409)
      }

      // Extract known fields, rest goes to data
      const { id: _, name, description, ...rest } = body
      const now = new Date().toISOString()

      const item: StoredItem = {
        id,
        name,
        description,
        data: Object.keys(rest).length > 0 ? rest : undefined,
        createdAt: now,
        updatedAt: now,
      }

      itemsMap.set(id, item)
      await this.ctx.storage.put('items', itemsMap)

      const itemResponse = this.formatItemResponse(item)

      return c.json(itemResponse, 201, {
        Location: `${COLLECTION_NS}/${encodeURIComponent(id)}`,
      })
    })

    // HEAD / - Check if collection exists
    app.on('HEAD', '/', () => {
      return new Response(null, { status: 200 })
    })

    // GET /:id - Get a specific item
    app.get('/:id', async (c) => {
      const id = decodeURIComponent(c.req.param('id'))

      const itemsMap = await this.ctx.storage.get<Map<string, StoredItem>>('items')
      const item = itemsMap?.get(id)

      if (!item) {
        return c.json({ $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' }, 404)
      }

      return c.json(this.formatItemResponse(item))
    })

    // PUT /:id - Update an item (replace)
    app.put('/:id', async (c) => {
      const id = decodeURIComponent(c.req.param('id'))

      const itemsMap = await this.ctx.storage.get<Map<string, StoredItem>>('items')
      const existing = itemsMap?.get(id)

      if (!existing) {
        return c.json({ $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' }, 404)
      }

      let body: { name?: string; description?: string; [key: string]: unknown }

      try {
        body = await c.req.json()
      } catch {
        return c.json({ $type: 'Error', error: 'Invalid JSON body', code: 'BAD_REQUEST' }, 400)
      }

      // Extract known fields
      const { name, description, $id: _, $type: __, $context: ___, ...rest } = body

      const updated: StoredItem = {
        ...existing,
        name: name ?? existing.name,
        description: description ?? existing.description,
        data: Object.keys(rest).length > 0 ? rest : existing.data,
        updatedAt: new Date().toISOString(),
      }

      itemsMap!.set(id, updated)
      await this.ctx.storage.put('items', itemsMap)

      return c.json(this.formatItemResponse(updated))
    })

    // PATCH /:id - Update an item (merge)
    app.patch('/:id', async (c) => {
      const id = decodeURIComponent(c.req.param('id'))

      const itemsMap = await this.ctx.storage.get<Map<string, StoredItem>>('items')
      const existing = itemsMap?.get(id)

      if (!existing) {
        return c.json({ $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' }, 404)
      }

      let body: { name?: string; description?: string; [key: string]: unknown }

      try {
        body = await c.req.json()
      } catch {
        return c.json({ $type: 'Error', error: 'Invalid JSON body', code: 'BAD_REQUEST' }, 400)
      }

      // Merge data
      const { name, description, $id: _, $type: __, $context: ___, ...rest } = body

      const updated: StoredItem = {
        ...existing,
        name: name !== undefined ? name : existing.name,
        description: description !== undefined ? description : existing.description,
        data: { ...(existing.data || {}), ...rest },
        updatedAt: new Date().toISOString(),
      }

      itemsMap!.set(id, updated)
      await this.ctx.storage.put('items', itemsMap)

      return c.json(this.formatItemResponse(updated))
    })

    // DELETE /:id - Delete an item
    app.delete('/:id', async (c) => {
      const id = decodeURIComponent(c.req.param('id'))

      const itemsMap = await this.ctx.storage.get<Map<string, StoredItem>>('items')

      if (!itemsMap?.has(id)) {
        return c.json({ $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' }, 404)
      }

      itemsMap.delete(id)
      await this.ctx.storage.put('items', itemsMap)

      return new Response(null, { status: 204 })
    })

    // HEAD /:id - Check if item exists
    app.on('HEAD', '/:id', async (c) => {
      const id = decodeURIComponent(c.req.param('id'))

      const itemsMap = await this.ctx.storage.get<Map<string, StoredItem>>('items')

      if (!itemsMap?.has(id)) {
        return new Response(null, { status: 404 })
      }

      return new Response(null, { status: 200 })
    })

    // Catch-all for nested paths (Collection<T> doesn't support nested paths)
    app.all('/:id/*', () => {
      return Response.json(
        { $type: 'Error', error: 'Nested paths not supported in Collection routing', code: 'NOT_FOUND' },
        { status: 404 }
      )
    })

    return app
  }

  /**
   * Format a stored item as a linked data response
   */
  private formatItemResponse(item: StoredItem): ItemResponse {
    return {
      $context: COLLECTION_NS,
      $type: COLLECTION_NS,
      $id: `${COLLECTION_NS}/${item.id}`,
      name: item.name,
      description: item.description,
      ...(item.data || {}),
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let id = ''
    for (let i = 0; i < 12; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return id
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}

export default TestCollectionDO
