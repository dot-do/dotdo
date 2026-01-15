/**
 * Router configuration for Docs SPA
 *
 * Creates the TanStack Router instance for client-side routing.
 *
 * @see https://tanstack.com/router/latest/docs/framework/react/guide/router-configuration
 */
import { createRouter as createTanStackRouter, createRootRoute, createRoute, Outlet } from '@tanstack/react-router'
import { DocsLayout } from './components/docs/layout'
import { DocsPage } from './components/docs/page'
import { source } from './lib/source'

/**
 * Root route - wraps all other routes
 */
const rootRoute = createRootRoute({
  component: () => <Outlet />,
})

/**
 * Home route - redirects to docs
 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <DocsLayout>
      <main className="prose dark:prose-invert max-w-3xl mx-auto py-8 px-4">
        <h1>dotdo Documentation</h1>
        <p>Durable Objects runtime framework</p>
        <a href="/docs/getting-started">Get Started</a>
      </main>
    </DocsLayout>
  ),
})

/**
 * Docs index route
 */
const docsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docs',
  component: () => {
    const page = source.getPage([])
    return (
      <DocsLayout>
        <DocsPage title="Documentation" description="dotdo documentation and guides">
          <p>Welcome to the dotdo documentation. Select a topic from the sidebar to get started.</p>
        </DocsPage>
      </DocsLayout>
    )
  },
})

/**
 * Docs catch-all route for MDX pages
 */
const docsSplatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/docs/$',
  component: () => {
    // In a full implementation, this would parse the splat param and load MDX
    return (
      <DocsLayout>
        <DocsPage title="Page" description="Documentation page">
          <p>Documentation page content would be rendered here.</p>
        </DocsPage>
      </DocsLayout>
    )
  },
})

/**
 * Route tree with all application routes
 */
const routeTree = rootRoute.addChildren([
  indexRoute,
  docsIndexRoute,
  docsSplatRoute,
])

/**
 * Creates and configures the TanStack Router instance
 */
export function createRouter() {
  return createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultNotFoundComponent: () => (
      <div className="prose dark:prose-invert max-w-3xl mx-auto py-8 px-4">
        <h1>404 - Page Not Found</h1>
        <p>The page you are looking for does not exist.</p>
      </div>
    ),
  })
}

/** Type of the router instance */
export type AppRouter = ReturnType<typeof createRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
