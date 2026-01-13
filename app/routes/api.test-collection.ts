/**
 * Test Collection API Route
 *
 * In-memory implementation of Collection<T> pattern for E2E testing.
 * Implements the single-collection DO pattern where root IS the collection.
 */
import { createFileRoute } from '@tanstack/react-router'

// In-memory store for test collection items
const testItems = new Map<string, { id: string; name: string; [key: string]: unknown }>([
  ['alice', { id: 'alice', name: 'Alice Test', email: 'alice@test.com' }],
  ['bob', { id: 'bob', name: 'Bob Test', email: 'bob@test.com' }],
  ['carol', { id: 'carol', name: 'Carol Test', email: 'carol@test.com' }],
])

/**
 * Build the namespace URL from request
 */
function getNs(request: Request): string {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}/api/test-collection`
}

/**
 * Build collection response with linked data
 */
function buildCollectionResponse(ns: string) {
  const items = Array.from(testItems.values()).map((item) => ({
    $context: ns,
    $type: ns,
    $id: `${ns}/${item.id}`,
    ...item,
  }))

  return {
    // Collection<T> pattern: $type === $id at root
    $context: 'https://schema.org.ai/Collection',
    $type: ns,
    $id: ns,
    count: items.length,
    items,
    links: {
      self: ns,
      first: ns,
    },
    actions: {
      create: { method: 'POST', href: ns },
    },
  }
}

/**
 * Build item response with linked data
 */
function buildItemResponse(ns: string, item: { id: string; name: string; [key: string]: unknown }) {
  return {
    $context: ns,
    $type: ns,
    $id: `${ns}/${item.id}`,
    ...item,
    links: {
      self: `${ns}/${item.id}`,
      collection: ns,
      edit: `${ns}/${item.id}/edit`,
    },
    actions: {
      update: { method: 'PUT', href: `${ns}/${item.id}` },
      delete: { method: 'DELETE', href: `${ns}/${item.id}` },
    },
  }
}

export const Route = createFileRoute('/api/test-collection')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ns = getNs(request)
        return Response.json(buildCollectionResponse(ns))
      },

      POST: async ({ request }) => {
        const ns = getNs(request)
        try {
          const body = await request.json() as { id?: string; name?: string; [key: string]: unknown }

          // Generate ID if not provided
          const id = body.id || `item-${Date.now()}`

          // Check for duplicate
          if (testItems.has(id)) {
            return Response.json(
              { error: { code: 'CONFLICT', message: `Item with id '${id}' already exists` } },
              { status: 409 }
            )
          }

          const item = { id, name: body.name || 'Unnamed', ...body }
          testItems.set(id, item)

          return Response.json(buildItemResponse(ns, item), { status: 201 })
        } catch {
          return Response.json(
            { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
            { status: 400 }
          )
        }
      },

      HEAD: async () => {
        return new Response(null, { status: 200 })
      },
    },
  },
})
