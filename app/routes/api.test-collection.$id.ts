/**
 * Test Collection Item API Route
 *
 * Handles individual items in the test collection.
 * Items are at /:id (not /:type/:id) per Collection<T> pattern.
 */
import { createFileRoute } from '@tanstack/react-router'

// Reference the same in-memory store (imported from parent route won't work, so we duplicate)
// In a real implementation, this would be a shared store or database
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

export const Route = createFileRoute('/api/test-collection/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ns = getNs(request)
        const id = params.id

        const item = testItems.get(id)
        if (!item) {
          return Response.json(
            { $type: 'Error', code: 'NOT_FOUND', message: `Item '${id}' not found`,
            { status: 404 }
          )
        }

        return Response.json(buildItemResponse(ns, item))
      },

      PUT: async ({ request, params }) => {
        const ns = getNs(request)
        const id = params.id

        if (!testItems.has(id)) {
          return Response.json(
            { $type: 'Error', code: 'NOT_FOUND', message: `Item '${id}' not found` },
            { status: 404 }
          )
        }

        try {
          const body = await request.json() as { name?: string; [key: string]: unknown }
          const item = { id, name: body.name || 'Unnamed', ...body }
          testItems.set(id, item)

          return Response.json(buildItemResponse(ns, item))
        } catch {
          return Response.json(
            { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
            { status: 400 }
          )
        }
      },

      PATCH: async ({ request, params }) => {
        const ns = getNs(request)
        const id = params.id

        const existing = testItems.get(id)
        if (!existing) {
          return Response.json(
            { $type: 'Error', code: 'NOT_FOUND', message: `Item '${id}' not found` },
            { status: 404 }
          )
        }

        try {
          const body = await request.json() as Record<string, unknown>
          const item = { ...existing, ...body, id }
          testItems.set(id, item)

          return Response.json(buildItemResponse(ns, item))
        } catch {
          return Response.json(
            { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
            { status: 400 }
          )
        }
      },

      DELETE: async ({ params }) => {
        const id = params.id

        if (!testItems.has(id)) {
          return Response.json(
            { $type: 'Error', code: 'NOT_FOUND', message: `Item '${id}' not found` },
            { status: 404 }
          )
        }

        testItems.delete(id)
        return new Response(null, { status: 204 })
      },
    },
  },
})
