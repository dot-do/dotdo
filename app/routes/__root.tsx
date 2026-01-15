/**
 * Root route for TanStack Start app
 *
 * This is the root layout component that wraps all other routes.
 * It provides the HTML structure, head elements, and outlet for nested routes.
 * Includes RootProvider from fumadocs for theme/search context.
 *
 * @see https://tanstack.com/start/latest/docs/routing/root-routes
 * @see https://fumadocs.dev/docs/manual-installation/tanstack-start
 */
import type { ReactNode } from 'react'
import {
  createRootRoute,
  Outlet,
  ScrollRestoration,
  ErrorComponent,
} from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider'
import '../styles/app.css'

/**
 * Error fallback component for route errors
 */
function RootErrorComponent({ error }: { error: Error }): ReactNode {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Error - dotdo</title>
      </head>
      <body>
        <main role="alert">
          <h1>Something went wrong</h1>
          <p>{error.message}</p>
          <ErrorComponent error={error} />
        </main>
      </body>
    </html>
  )
}

/**
 * Pending/loading state component
 */
function RootPendingComponent(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Loading">
      Loading...
    </div>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  pendingComponent: RootPendingComponent,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'dotdo' },
      { name: 'description', content: 'Durable Objects runtime framework' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.ico' },
    ],
  }),
})

/**
 * Root layout component
 *
 * Provides the HTML document structure for all routes.
 * Wraps application with RootProvider for fumadocs theming/search.
 * Head elements are managed by TanStack Start's head() configuration.
 */
function RootComponent(): ReactNode {
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body>
        <RootProvider>
          <Outlet />
        </RootProvider>
        <ScrollRestoration />
      </body>
    </html>
  )
}
