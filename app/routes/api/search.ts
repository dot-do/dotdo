import { createFileRoute } from '@tanstack/react-router'
import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '../../lib/source'

export const Route = createFileRoute('/api/search')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const server = createFromSource(source, { language: 'english' })
        return server.GET(request)
      },
    },
  },
})
