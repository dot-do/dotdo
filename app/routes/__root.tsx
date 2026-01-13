import { createRootRoute, Outlet, HeadContent, Scripts, useRouterState } from '@tanstack/react-router'
import { RootProvider } from 'fumadocs-ui/provider/tanstack'
import React, { useEffect, Suspense } from 'react'
import { ThemeScript, useThemeStore } from '@mdxui/themes'
import { ErrorBoundary } from '../components/ui/error-boundary'
import { RouteProgressBar, RoutePending, RouteError, RouteNotFound } from '../components/ui/route-transition'

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
    ],
  }),
  // Default pending component for all routes
  pendingComponent: () => <RoutePending showSkeleton />,
  // Default error component for all routes
  errorComponent: ({ error, reset }) => (
    <RouteError error={error as Error} reset={reset} />
  ),
  // Not found handler
  notFoundComponent: () => <RouteNotFound />,
})

function ThemeInitializer() {
  const { initialize, applyTheme } = useThemeStore()

  useEffect(() => {
    initialize()
    applyTheme()
  }, [initialize, applyTheme])

  return null
}

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <ThemeScript defaultMode="system" />
      </head>
      <body className="theme-transition">
        <ThemeInitializer />
        <RouteProgressBar />
        <RootProvider>
          <ErrorBoundary>
            <Suspense fallback={<RoutePending showSkeleton />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </RootProvider>
        <Scripts />
      </body>
    </html>
  )
}
