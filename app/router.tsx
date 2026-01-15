/**
 * Router configuration for TanStack Start
 *
 * Creates the router instance with file-based routing.
 * This is imported by both client and server entry points.
 *
 * @see https://tanstack.com/start/latest/docs/routing/router
 */
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

/**
 * Router configuration options
 */
export interface RouterOptions {
  /** Preload strategy for route transitions */
  defaultPreload?: 'intent' | 'viewport' | 'render' | false
  /** Default pending delay in ms before showing pending UI */
  defaultPendingMs?: number
  /** Default minimum pending time in ms */
  defaultPendingMinMs?: number
}

/**
 * Creates and configures the TanStack Router instance
 *
 * @param options - Optional router configuration overrides
 * @returns Configured router instance
 */
export function createRouter(options: RouterOptions = {}) {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: options.defaultPreload ?? 'intent',
    defaultPendingMs: options.defaultPendingMs,
    defaultPendingMinMs: options.defaultPendingMinMs,
    defaultNotFoundComponent: () => (
      <div>
        <h1>404 - Page Not Found</h1>
        <p>The page you are looking for does not exist.</p>
      </div>
    ),
  })

  return router
}

/** Type of the router instance */
export type AppRouter = ReturnType<typeof createRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
