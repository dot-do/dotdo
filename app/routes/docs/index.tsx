import { createFileRoute, redirect, useLocation } from '@tanstack/react-router'

/**
 * /docs index route - redirects to getting-started
 *
 * NOTE: Only matches exact /docs or /docs/ - not /docs/anything
 */
export const Route = createFileRoute('/docs/')({
  component: DocsIndexPage,
  beforeLoad: ({ location }) => {
    // Only redirect if we're exactly at /docs or /docs/
    // If we have more path segments, don't redirect
    if (location.pathname === '/docs' || location.pathname === '/docs/') {
      throw redirect({
        to: '/docs/getting-started',
      })
    }
  },
})

function DocsIndexPage() {
  const location = useLocation()
  return (
    <div>
      <h1>Docs Index</h1>
      <p>Path: {location.pathname}</p>
      <p>This should only render for /docs or /docs/</p>
    </div>
  )
}
