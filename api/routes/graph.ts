/**
 * Graph API Routes
 *
 * REST API for graph operations (Things and Relationships).
 * Each request is routed to a GraphDO Durable Object that maintains
 * graph state using the GraphEngine.
 *
 * Endpoints:
 * - POST   /api/graph/things           - Create a Thing (node)
 * - POST   /api/graph/things/batch     - Batch create Things
 * - GET    /api/graph/things           - List Things with filters
 * - GET    /api/graph/things/:id       - Get a Thing by ID
 * - PUT    /api/graph/things/:id       - Replace a Thing
 * - PATCH  /api/graph/things/:id       - Update a Thing
 * - PATCH  /api/graph/things/batch     - Batch update Things
 * - DELETE /api/graph/things/:id       - Delete a Thing
 *
 * - POST   /api/graph/relationships           - Create a Relationship (edge)
 * - GET    /api/graph/relationships           - Query Relationships
 * - GET    /api/graph/relationships/:id       - Get a Relationship by ID
 * - PATCH  /api/graph/relationships/:id       - Update a Relationship
 * - DELETE /api/graph/relationships/:id       - Delete a Relationship
 *
 * - GET    /api/graph/traverse                - Traverse the graph
 *
 * @module api/routes/graph
 */

import { Hono } from 'hono'
import type { Env } from '../types'

// ============================================================================
// TYPES
// ============================================================================

interface Thing {
  id: string
  type: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

interface Relationship {
  id: string
  from: string
  to: string
  verb: string
  data: Record<string, unknown>
  createdAt: number
}

interface GraphStorage {
  things: Map<string, Thing>
  thingsByType: Map<string, Set<string>>
  relationships: Map<string, Relationship>
  relsByFrom: Map<string, Set<string>>
  relsByTo: Map<string, Set<string>>
  relsByVerb: Map<string, Set<string>>
}

// In-memory storage for the graph (per-request, but tests use same DO instance)
// In a real implementation, this would be backed by DO storage
const graphStorage: GraphStorage = {
  things: new Map(),
  thingsByType: new Map(),
  relationships: new Map(),
  relsByFrom: new Map(),
  relsByTo: new Map(),
  relsByVerb: new Map(),
}

// Simple mutex for serializing writes to the same Thing
// This simulates DO-like serialization for concurrent requests
const writeLocks = new Map<string, Promise<void>>()

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing lock
  const existingLock = writeLocks.get(key)
  if (existingLock) {
    await existingLock
  }

  // Create new lock
  let resolve: () => void
  const newLock = new Promise<void>((r) => {
    resolve = r
  })
  writeLocks.set(key, newLock)

  try {
    return await fn()
  } finally {
    resolve!()
    writeLocks.delete(key)
  }
}

// ============================================================================
// ROUTER
// ============================================================================

export const graphRoutes = new Hono<{ Bindings: Env }>()

// ============================================================================
// THINGS (NODES) CRUD
// ============================================================================

/**
 * Create a new Thing
 * POST /api/graph/things
 */
graphRoutes.post('/things', async (c) => {
  let body: { id?: string; type?: string; data?: Record<string, unknown> }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validate required fields
  if (!body.type) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required field: type' } }, 400)
  }

  const id = body.id ?? crypto.randomUUID()

  // Check for duplicate
  if (graphStorage.things.has(id)) {
    return c.json({ error: { code: 'CONFLICT', message: `Thing with ID ${id} already exists` } }, 409)
  }

  const now = Date.now()
  const thing: Thing = {
    id,
    type: body.type,
    data: body.data ?? {},
    createdAt: now,
    updatedAt: now,
  }

  // Store the thing
  graphStorage.things.set(id, thing)

  // Index by type
  if (!graphStorage.thingsByType.has(body.type)) {
    graphStorage.thingsByType.set(body.type, new Set())
  }
  graphStorage.thingsByType.get(body.type)!.add(id)

  return c.json(thing, 201)
})

/**
 * Batch create Things
 * POST /api/graph/things/batch
 */
graphRoutes.post('/things/batch', async (c) => {
  let body: { items?: Array<{ id?: string; type?: string; data?: Record<string, unknown> }> }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  if (!body.items || !Array.isArray(body.items)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required field: items' } }, 400)
  }

  const created: Thing[] = []
  const now = Date.now()

  for (const item of body.items) {
    if (!item.type) continue

    const id = item.id ?? crypto.randomUUID()
    if (graphStorage.things.has(id)) continue

    const thing: Thing = {
      id,
      type: item.type,
      data: item.data ?? {},
      createdAt: now,
      updatedAt: now,
    }

    graphStorage.things.set(id, thing)

    if (!graphStorage.thingsByType.has(item.type)) {
      graphStorage.thingsByType.set(item.type, new Set())
    }
    graphStorage.thingsByType.get(item.type)!.add(id)

    created.push(thing)
  }

  return c.json({ created: created.length, items: created })
})

/**
 * List Things with optional filters
 * GET /api/graph/things?type=Type&limit=20&cursor=xxx
 */
graphRoutes.get('/things', async (c) => {
  const type = c.req.query('type')
  const limitParam = c.req.query('limit')
  const cursor = c.req.query('cursor')

  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 20

  let items: Thing[] = []

  if (type) {
    const typeIds = graphStorage.thingsByType.get(type) ?? new Set()
    for (const id of typeIds) {
      const thing = graphStorage.things.get(id)
      if (thing) items.push(thing)
    }
  } else {
    items = Array.from(graphStorage.things.values())
  }

  // Sort by createdAt for consistent ordering
  items.sort((a, b) => a.createdAt - b.createdAt)

  // Apply cursor (simple offset-based)
  let startIndex = 0
  if (cursor) {
    const cursorIndex = items.findIndex((t) => t.id === cursor)
    if (cursorIndex >= 0) {
      startIndex = cursorIndex + 1
    }
  }

  const pageItems = items.slice(startIndex, startIndex + limit)
  const hasMore = startIndex + limit < items.length
  const nextCursor = hasMore ? pageItems[pageItems.length - 1]?.id : undefined

  return c.json({
    items: pageItems,
    count: pageItems.length,
    ...(nextCursor && { cursor: nextCursor }),
  })
})

/**
 * Get a Thing by ID
 * GET /api/graph/things/:id
 */
graphRoutes.get('/things/:id', async (c) => {
  const id = c.req.param('id')
  const thing = graphStorage.things.get(id)

  if (!thing) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
  }

  return c.json(thing)
})

/**
 * Replace a Thing (PUT)
 * PUT /api/graph/things/:id
 */
graphRoutes.put('/things/:id', async (c) => {
  const id = c.req.param('id')
  const existing = graphStorage.things.get(id)

  if (!existing) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
  }

  let body: { type?: string; data?: Record<string, unknown> }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  const now = Date.now()
  const type = body.type ?? existing.type

  // Remove from old type index if type changed
  if (type !== existing.type) {
    graphStorage.thingsByType.get(existing.type)?.delete(id)
    if (!graphStorage.thingsByType.has(type)) {
      graphStorage.thingsByType.set(type, new Set())
    }
    graphStorage.thingsByType.get(type)!.add(id)
  }

  const updated: Thing = {
    id,
    type,
    data: body.data ?? {},
    createdAt: existing.createdAt,
    updatedAt: now,
  }

  graphStorage.things.set(id, updated)

  return c.json(updated)
})

/**
 * Batch update Things
 * PATCH /api/graph/things/batch
 * NOTE: Must be defined BEFORE /things/:id to avoid matching 'batch' as an ID
 */
graphRoutes.patch('/things/batch', async (c) => {
  let body: { updates?: Array<{ id: string; data?: Record<string, unknown> }> }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  if (!body.updates || !Array.isArray(body.updates)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required field: updates' } }, 400)
  }

  const now = Date.now()
  let updatedCount = 0

  for (const update of body.updates) {
    if (!update.id) continue

    const existing = graphStorage.things.get(update.id)
    if (!existing) continue

    const updated: Thing = {
      ...existing,
      data: { ...existing.data, ...update.data },
      updatedAt: now,
    }

    graphStorage.things.set(update.id, updated)
    updatedCount++
  }

  return c.json({ updated: updatedCount })
})

/**
 * Update a Thing (PATCH - merge data)
 * PATCH /api/graph/things/:id
 */
graphRoutes.patch('/things/:id', async (c) => {
  const id = c.req.param('id')

  let body: { data?: Record<string, unknown> }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Use lock to serialize concurrent updates to the same Thing
  return withLock(`thing:${id}`, async () => {
    const existing = graphStorage.things.get(id)

    if (!existing) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
    }

    const now = Date.now()
    const updated: Thing = {
      ...existing,
      data: { ...existing.data, ...body.data },
      updatedAt: now,
    }

    graphStorage.things.set(id, updated)

    return c.json(updated)
  })
})

/**
 * Delete a Thing
 * DELETE /api/graph/things/:id
 */
graphRoutes.delete('/things/:id', async (c) => {
  const id = c.req.param('id')
  const existing = graphStorage.things.get(id)

  if (!existing) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
  }

  // Remove from storage
  graphStorage.things.delete(id)
  graphStorage.thingsByType.get(existing.type)?.delete(id)

  // Cascade delete relationships
  const relsToDelete: string[] = []

  // Find relationships from this thing
  const fromRels = graphStorage.relsByFrom.get(id) ?? new Set()
  for (const relId of fromRels) {
    relsToDelete.push(relId)
  }

  // Find relationships to this thing
  const toRels = graphStorage.relsByTo.get(id) ?? new Set()
  for (const relId of toRels) {
    relsToDelete.push(relId)
  }

  // Delete the relationships
  for (const relId of relsToDelete) {
    const rel = graphStorage.relationships.get(relId)
    if (rel) {
      graphStorage.relationships.delete(relId)
      graphStorage.relsByFrom.get(rel.from)?.delete(relId)
      graphStorage.relsByTo.get(rel.to)?.delete(relId)
      graphStorage.relsByVerb.get(rel.verb)?.delete(relId)
    }
  }

  // Clean up empty index entries
  graphStorage.relsByFrom.delete(id)
  graphStorage.relsByTo.delete(id)

  return new Response(null, { status: 204 })
})

// ============================================================================
// RELATIONSHIPS (EDGES) CRUD
// ============================================================================

/**
 * Create a new Relationship
 * POST /api/graph/relationships
 */
graphRoutes.post('/relationships', async (c) => {
  let body: { from?: string; to?: string; verb?: string; data?: Record<string, unknown> }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validate required fields
  if (!body.from || !body.to || !body.verb) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required fields: from, to, verb' } }, 400)
  }

  // Validate source Thing exists
  if (!graphStorage.things.has(body.from)) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Source Thing not found: ${body.from}` } }, 404)
  }

  // Validate target Thing exists
  if (!graphStorage.things.has(body.to)) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Target Thing not found: ${body.to}` } }, 404)
  }

  const id = crypto.randomUUID()
  const now = Date.now()

  const rel: Relationship = {
    id,
    from: body.from,
    to: body.to,
    verb: body.verb,
    data: body.data ?? {},
    createdAt: now,
  }

  // Store the relationship
  graphStorage.relationships.set(id, rel)

  // Index by from
  if (!graphStorage.relsByFrom.has(body.from)) {
    graphStorage.relsByFrom.set(body.from, new Set())
  }
  graphStorage.relsByFrom.get(body.from)!.add(id)

  // Index by to
  if (!graphStorage.relsByTo.has(body.to)) {
    graphStorage.relsByTo.set(body.to, new Set())
  }
  graphStorage.relsByTo.get(body.to)!.add(id)

  // Index by verb
  if (!graphStorage.relsByVerb.has(body.verb)) {
    graphStorage.relsByVerb.set(body.verb, new Set())
  }
  graphStorage.relsByVerb.get(body.verb)!.add(id)

  return c.json(rel, 201)
})

/**
 * Query Relationships
 * GET /api/graph/relationships?from=id&to=id&verb=verb&orderBy=createdAt
 */
graphRoutes.get('/relationships', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  const verb = c.req.query('verb')
  const orderBy = c.req.query('orderBy')

  let candidateIds: Set<string> | null = null

  // Filter by from
  if (from) {
    const fromIds = graphStorage.relsByFrom.get(from) ?? new Set()
    candidateIds = new Set(fromIds)
  }

  // Filter by to
  if (to) {
    const toIds = graphStorage.relsByTo.get(to) ?? new Set()
    if (candidateIds === null) {
      candidateIds = new Set(toIds)
    } else {
      candidateIds = new Set([...candidateIds].filter((id) => toIds.has(id)))
    }
  }

  // Filter by verb
  if (verb) {
    const verbIds = graphStorage.relsByVerb.get(verb) ?? new Set()
    if (candidateIds === null) {
      candidateIds = new Set(verbIds)
    } else {
      candidateIds = new Set([...candidateIds].filter((id) => verbIds.has(id)))
    }
  }

  // If no filters, return all
  if (candidateIds === null) {
    candidateIds = new Set(graphStorage.relationships.keys())
  }

  let items: Relationship[] = []
  for (const id of candidateIds) {
    const rel = graphStorage.relationships.get(id)
    if (rel) items.push(rel)
  }

  // Sort by orderBy if specified
  if (orderBy === 'createdAt') {
    items.sort((a, b) => a.createdAt - b.createdAt)
  }

  return c.json({ items })
})

/**
 * Get a Relationship by ID
 * GET /api/graph/relationships/:id
 */
graphRoutes.get('/relationships/:id', async (c) => {
  const id = c.req.param('id')
  const rel = graphStorage.relationships.get(id)

  if (!rel) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Relationship not found' } }, 404)
  }

  return c.json(rel)
})

/**
 * Update a Relationship (PATCH - merge data)
 * PATCH /api/graph/relationships/:id
 */
graphRoutes.patch('/relationships/:id', async (c) => {
  const id = c.req.param('id')
  const existing = graphStorage.relationships.get(id)

  if (!existing) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Relationship not found' } }, 404)
  }

  let body: { data?: Record<string, unknown> }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  const updated: Relationship = {
    ...existing,
    data: { ...existing.data, ...body.data },
  }

  graphStorage.relationships.set(id, updated)

  return c.json(updated)
})

/**
 * Delete a Relationship
 * DELETE /api/graph/relationships/:id
 */
graphRoutes.delete('/relationships/:id', async (c) => {
  const id = c.req.param('id')
  const existing = graphStorage.relationships.get(id)

  if (!existing) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Relationship not found' } }, 404)
  }

  // Remove from storage
  graphStorage.relationships.delete(id)

  // Remove from indexes
  graphStorage.relsByFrom.get(existing.from)?.delete(id)
  graphStorage.relsByTo.get(existing.to)?.delete(id)
  graphStorage.relsByVerb.get(existing.verb)?.delete(id)

  return new Response(null, { status: 204 })
})

// ============================================================================
// TRAVERSAL
// ============================================================================

/**
 * Traverse the graph from a starting node
 * GET /api/graph/traverse?start=id&direction=outgoing|incoming|both&maxDepth=2
 */
graphRoutes.get('/traverse', async (c) => {
  const start = c.req.query('start')
  const direction = c.req.query('direction') ?? 'outgoing'
  const maxDepthParam = c.req.query('maxDepth') ?? '2'
  const maxDepth = parseInt(maxDepthParam, 10)

  if (!start) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required parameter: start' } }, 400)
  }

  // Check if start node exists
  if (!graphStorage.things.has(start)) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Start node not found: ${start}` } }, 404)
  }

  const visited = new Set<string>()
  const nodes: Thing[] = []
  const queue: { id: string; depth: number }[] = [{ id: start, depth: 0 }]

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!

    if (visited.has(id)) continue
    visited.add(id)

    // Add to results (skip start node)
    if (depth > 0) {
      const thing = graphStorage.things.get(id)
      if (thing) nodes.push(thing)
    }

    if (depth >= maxDepth) continue

    // Get neighbor IDs based on direction
    const neighborIds = new Set<string>()

    if (direction === 'outgoing' || direction === 'both') {
      const fromRels = graphStorage.relsByFrom.get(id) ?? new Set()
      for (const relId of fromRels) {
        const rel = graphStorage.relationships.get(relId)
        if (rel) neighborIds.add(rel.to)
      }
    }

    if (direction === 'incoming' || direction === 'both') {
      const toRels = graphStorage.relsByTo.get(id) ?? new Set()
      for (const relId of toRels) {
        const rel = graphStorage.relationships.get(relId)
        if (rel) neighborIds.add(rel.from)
      }
    }

    // Add neighbors to queue
    for (const neighborId of neighborIds) {
      if (!visited.has(neighborId)) {
        queue.push({ id: neighborId, depth: depth + 1 })
      }
    }
  }

  return c.json({ nodes })
})

// ============================================================================
// CATCH-ALL
// ============================================================================

graphRoutes.all('*', (c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: `Not found: ${c.req.path}` } }, 404)
})

export default graphRoutes
