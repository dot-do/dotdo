/**
 * CollectionDO - Single-Collection Durable Object Base Class
 *
 * A Collection<T> base class that routes at /:id instead of /:type/:id.
 * This is for DOs that ARE a collection (like Startups.Studio),
 * not DOs that HAVE collections (like a CRM).
 *
 * Key differences from Entity-based DOs:
 * - GET / returns the collection itself (root IS the collection)
 * - GET /:id returns an item directly (not /:type/:id)
 * - POST / creates an item (not POST /:type)
 * - $type === $id at root level (the collection is both its type and identity)
 * - $context points to schema.org.ai/Collection for orphan Collection
 *
 * @example
 * ```typescript
 * // Startups.Studio - a collection of startups
 * class StartupsStudio extends CollectionDO {
 *   static override readonly $type = 'Collection'
 * }
 *
 * // GET https://Startups.Studio/ -> collection root
 * // GET https://Startups.Studio/headless.ly -> startup item
 * // POST https://Startups.Studio/ -> create startup
 * ```
 */

import { DO, type Env } from '../core/DO'
import { ThingsStore, type ThingEntity, type StoreContext } from '../../db/stores'
import * as schema from '../../db'
import { buildCollectionResponse, type CollectionResponseOptions } from '../../lib/response/collection'

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Schema.org.ai context URL for orphan collections
 */
const COLLECTION_CONTEXT = 'https://schema.org.ai/Collection'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Mock ThingsStore interface for testing
 * Matches the subset of ThingsStore methods used by CollectionDO
 */
export interface MockThingsStore {
  list(options?: { limit?: number; after?: string }): Promise<ThingEntity[]>
  get(id: string): Promise<ThingEntity | null>
  create(data: { $id?: string; $type: string; name?: string; data?: Record<string, unknown> }): Promise<ThingEntity>
  update(id: string, data: { name?: string; data?: Record<string, unknown> }, options?: { merge?: boolean }): Promise<ThingEntity>
  delete(id: string): Promise<ThingEntity>
}

/**
 * Configuration options for CollectionDO initialization
 */
export interface CollectionDOConfig {
  /** Namespace URL - the collection's identity (e.g., 'https://Startups.Studio') */
  ns: string
  /** Parent context URL (for nested collections) */
  parent?: string
  /** Item type description (for metadata) */
  itemType?: string
}

/**
 * Collection root response shape
 */
export interface CollectionRootResponse {
  $context: string
  $type: string
  $id: string
  items: CollectionItemResponse[]
  count: number
  cursor?: string
}

/**
 * Collection item response shape
 */
export interface CollectionItemResponse {
  $context: string
  $type: string
  $id: string
  name?: string
  [key: string]: unknown
}

// ============================================================================
// COLLECTION DO CLASS
// ============================================================================

/**
 * CollectionDO - Base class for single-collection Durable Objects
 *
 * Routes:
 * - GET /           -> Collection root (list items)
 * - GET /:id        -> Get item by ID
 * - POST /          -> Create item
 * - PUT /:id        -> Update item (replace)
 * - PATCH /:id      -> Update item (merge)
 * - DELETE /:id     -> Delete item
 */
export class CollectionDO<E extends Env = Env> extends DO<E> {
  // ═══════════════════════════════════════════════════════════════════════════
  // TYPE DISCRIMINATOR
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Static $type property - identifies this as a Collection
   */
  static override readonly $type: string = 'Collection'

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLECTION PROPERTIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Parent context URL (for nested collections)
   * If undefined, this is an orphan collection and $context = schema.org.ai/Collection
   */
  protected _parent?: string

  /**
   * Item type description (for metadata)
   * Defaults to 'Item' if not specified
   */
  protected _itemType: string = 'Item'

  /**
   * Getter for parent context
   */
  get parent(): string | undefined {
    return this._parent
  }

  /**
   * Getter for item type
   */
  get itemType(): string {
    return this._itemType
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THINGS STORE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * ThingsStore for item CRUD operations
   * Can be overridden for testing by setting _things directly
   */
  protected _things?: ThingsStore | MockThingsStore

  /**
   * Get the ThingsStore, creating it lazily
   */
  protected get things(): ThingsStore | MockThingsStore {
    if (!this._things) {
      const storeCtx: StoreContext = {
        db: this.db,
        schema,
        ns: this.ns,
      }
      this._things = new ThingsStore(storeCtx)
    }
    return this._things
  }

  /**
   * Set a mock ThingsStore for testing
   */
  setThingsStore(store: ThingsStore | MockThingsStore): void {
    this._things = store
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialize the collection with configuration
   */
  override async initialize(config: CollectionDOConfig): Promise<void> {
    await super.initialize(config)

    this._parent = config.parent
    // Only override _itemType if explicitly provided, preserving the default 'Item'
    if (config.itemType !== undefined) {
      this._itemType = config.itemType
    }

    // Store parent if provided
    if (config.parent) {
      await this.ctx.storage.put('parent', config.parent)
    }
    if (config.itemType) {
      await this.ctx.storage.put('itemType', config.itemType)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP ROUTING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle incoming HTTP requests with single-collection routing
   */
  protected override async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    // Built-in /health endpoint
    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        ns: this.ns,
        $type: this.$type,
        itemType: this._itemType,
      })
    }

    // Parse the path
    const segments = url.pathname.slice(1).split('/').filter(Boolean)

    // Root path: collection operations
    if (segments.length === 0 || url.pathname === '/') {
      return this.handleCollectionRoot(method, request)
    }

    // Item path: /:id operations
    if (segments.length === 1) {
      const id = decodeURIComponent(segments[0]!)
      return this.handleItem(method, id, request)
    }

    // Nested paths not supported in single-collection routing
    // Could be extended for sub-resources in the future
    return Response.json(
      {
        $type: 'Error',
        error: 'Nested paths not supported in Collection routing',
        code: 'NOT_FOUND',
      },
      { status: 404 }
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COLLECTION ROOT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle requests to the collection root (/)
   */
  protected async handleCollectionRoot(method: string, request: Request): Promise<Response> {
    switch (method) {
      case 'GET':
        return this.handleListItems(request)
      case 'POST':
        return this.handleCreateItem(request)
      case 'HEAD':
        return this.handleHeadCollection()
      default:
        return Response.json(
          { $type: 'Error', error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
          { status: 405, headers: { Allow: 'GET, POST, HEAD' } }
        )
    }
  }

  /**
   * GET / - List all items in the collection
   */
  protected async handleListItems(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const limit = parseInt(url.searchParams.get('limit') || '100', 10)
    const after = url.searchParams.get('after') || undefined

    try {
      // Get items from store
      const items = await this.things.list({ limit, after })

      // Determine $context
      const $context = this._parent || COLLECTION_CONTEXT

      // Build item responses
      const itemResponses: CollectionItemResponse[] = items.map((item) =>
        this.formatItemResponse(item)
      )

      // Build collection response
      const response: CollectionRootResponse = {
        $context,
        $type: this.ns,
        $id: this.ns,
        items: itemResponses,
        count: items.length,
      }

      // Add cursor for pagination if we might have more
      if (items.length === limit && items.length > 0) {
        response.cursor = items[items.length - 1]!.$id
      }

      return Response.json(response, {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      // Return empty collection on error
      const $context = this._parent || COLLECTION_CONTEXT
      return Response.json(
        {
          $context,
          $type: this.ns,
          $id: this.ns,
          items: [],
          count: 0,
        },
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  /**
   * POST / - Create a new item
   */
  protected async handleCreateItem(request: Request): Promise<Response> {
    // Parse request body
    const body = await this.parseRequestBody(request)
    if (!body.success) {
      return Response.json(
        { $type: 'Error', error: body.error, code: 'BAD_REQUEST' },
        { status: body.status }
      )
    }

    const { id: providedId, ...data } = body.data as Record<string, unknown> & { id?: string }

    // Generate ID if not provided
    const id = providedId || this.generateId()

    try {
      // Check for duplicate
      const existing = await this.things.get(id)
      if (existing) {
        return Response.json(
          { $type: 'Error', error: `Item '${id}' already exists`, code: 'CONFLICT' },
          { status: 409 }
        )
      }

      // Create the item
      const item = await this.things.create({
        $id: id,
        $type: this._itemType || 'Item',
        name: data.name as string | undefined,
        data: data,
      })

      // Format response
      const itemResponse = this.formatItemResponse(item)

      // Build full item URL
      const itemUrl = `${this.ns}/${encodeURIComponent(id)}`

      return Response.json(itemResponse, {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          Location: itemUrl,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Create failed'

      // Check for duplicate error from DB
      if (message.includes('already exists') || message.includes('UNIQUE constraint')) {
        return Response.json(
          { $type: 'Error', error: message, code: 'CONFLICT' },
          { status: 409 }
        )
      }

      return Response.json(
        { $type: 'Error', error: message, code: 'CREATE_FAILED' },
        { status: 500 }
      )
    }
  }

  /**
   * HEAD / - Check if collection exists
   */
  protected async handleHeadCollection(): Promise<Response> {
    return new Response(null, { status: 200 })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ITEM HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle requests to a specific item (/:id)
   */
  protected async handleItem(method: string, id: string, request: Request): Promise<Response> {
    switch (method) {
      case 'GET':
        return this.handleGetItem(id)
      case 'PUT':
        return this.handleUpdateItem(id, request, { merge: false })
      case 'PATCH':
        return this.handleUpdateItem(id, request, { merge: true })
      case 'DELETE':
        return this.handleDeleteItem(id)
      case 'HEAD':
        return this.handleHeadItem(id)
      default:
        return Response.json(
          { $type: 'Error', error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
          { status: 405, headers: { Allow: 'GET, PUT, PATCH, DELETE, HEAD' } }
        )
    }
  }

  /**
   * GET /:id - Get a specific item
   */
  protected async handleGetItem(id: string): Promise<Response> {
    try {
      const item = await this.things.get(id)

      if (!item) {
        return Response.json(
          { $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' },
          { status: 404 }
        )
      }

      const itemResponse = this.formatItemResponse(item)

      return Response.json(itemResponse, {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      return Response.json(
        { $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' },
        { status: 404 }
      )
    }
  }

  /**
   * PUT/PATCH /:id - Update an item
   */
  protected async handleUpdateItem(
    id: string,
    request: Request,
    options: { merge: boolean }
  ): Promise<Response> {
    // Parse request body
    const body = await this.parseRequestBody(request)
    if (!body.success) {
      return Response.json(
        { $type: 'Error', error: body.error, code: 'BAD_REQUEST' },
        { status: body.status }
      )
    }

    try {
      // Verify item exists
      const existing = await this.things.get(id)
      if (!existing) {
        return Response.json(
          { $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' },
          { status: 404 }
        )
      }

      const { $id: _, $type: __, $context: ___, ...data } = body.data as Record<string, unknown>

      // Update the item
      const updated = await this.things.update(id, {
        name: data.name as string | undefined,
        data: data,
      }, { merge: options.merge })

      const itemResponse = this.formatItemResponse(updated)

      return Response.json(itemResponse, {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      return Response.json(
        { $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' },
        { status: 404 }
      )
    }
  }

  /**
   * DELETE /:id - Delete an item
   */
  protected async handleDeleteItem(id: string): Promise<Response> {
    try {
      // Verify item exists
      const existing = await this.things.get(id)
      if (!existing) {
        return Response.json(
          { $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' },
          { status: 404 }
        )
      }

      await this.things.delete(id)

      return new Response(null, { status: 204 })
    } catch {
      return Response.json(
        { $type: 'Error', error: `Item not found: ${id}`, code: 'NOT_FOUND' },
        { status: 404 }
      )
    }
  }

  /**
   * HEAD /:id - Check if item exists
   */
  protected async handleHeadItem(id: string): Promise<Response> {
    try {
      const item = await this.things.get(id)
      if (!item) {
        return new Response(null, { status: 404 })
      }
      return new Response(null, { status: 200 })
    } catch {
      return new Response(null, { status: 404 })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Format a ThingEntity as a CollectionItemResponse
   *
   * For Collection<T>:
   * - $context = collection namespace (this.ns)
   * - $type = collection namespace (homogeneous - all items same type)
   * - $id = full URL to item (ns + '/' + id)
   */
  protected formatItemResponse(item: ThingEntity): CollectionItemResponse {
    return {
      $context: this.ns,
      $type: this.ns,
      $id: `${this.ns}/${item.$id}`,
      name: item.name ?? undefined,
      ...(item.data ?? {}),
    }
  }

  /**
   * Generate a unique ID for a new item
   */
  protected generateId(): string {
    // Use a simple random ID generator
    // Could be overridden in subclasses for custom ID generation
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let id = ''
    for (let i = 0; i < 12; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return id
  }

  /**
   * Parse request body as JSON
   */
  protected async parseRequestBody(
    request: Request
  ): Promise<
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: string; status: number }
  > {
    const contentType = request.headers.get('Content-Type') || ''

    // Validate Content-Type
    if (contentType && !contentType.includes('application/json')) {
      return {
        success: false,
        error: `Unsupported Content-Type: ${contentType}. Expected application/json`,
        status: 415,
      }
    }

    try {
      const text = await request.text()
      if (!text.trim()) {
        return { success: true, data: {} }
      }
      return { success: true, data: JSON.parse(text) }
    } catch {
      return {
        success: false,
        error: 'Invalid JSON body',
        status: 400,
      }
    }
  }
}

export default CollectionDO
