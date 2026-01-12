import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/docs/')({
  loader: async () => {
    // Redirect /docs/ to /docs/index (the actual docs index page)
    throw redirect({ to: '/docs/index' })
  },
})
