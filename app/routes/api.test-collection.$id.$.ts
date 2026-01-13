/**
 * Test Collection Nested Path Handler
 *
 * Catches any nested paths under /api/test-collection/:id/* and returns 404.
 * Collection<T> only supports /:id routing, not nested paths.
 */
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/test-collection/$id/$')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(
          { $type: 'Error', code: 'NOT_FOUND', message: 'Nested paths not supported in Collection<T>' },
          { status: 404 }
        )
      },
      POST: async () => {
        return Response.json(
          { $type: 'Error', code: 'NOT_FOUND', message: 'Nested paths not supported in Collection<T>' },
          { status: 404 }
        )
      },
      PUT: async () => {
        return Response.json(
          { $type: 'Error', code: 'NOT_FOUND', message: 'Nested paths not supported in Collection<T>' },
          { status: 404 }
        )
      },
      DELETE: async () => {
        return Response.json(
          { $type: 'Error', code: 'NOT_FOUND', message: 'Nested paths not supported in Collection<T>' },
          { status: 404 }
        )
      },
    },
  },
})
