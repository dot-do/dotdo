/**
 * Schema API Route
 *
 * Returns the JSON-LD context definition for the API schema.
 * This route is the target of $context URLs in API responses.
 */
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/schema/api')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const baseNs = `${url.protocol}//${url.host}`

        // Return a JSON-LD context document
        const schema = {
          '@context': {
            '@vocab': `${baseNs}/`,
            'Customer': `${baseNs}/customers`,
            'Thing': `${baseNs}/things`,
          },
          '@type': 'APIContext',
          name: 'dotdo API Schema',
          version: '0.0.1',
          description: 'JSON-LD context for dotdo API responses',
        }

        return Response.json(schema)
      },
    },
  },
})
