import { createRouter as createTanStackRouter } from '@tanstack/react-router'
// @ts-ignore - Generated file
import { routeTree } from './routeTree.gen'

/**
 * Router Configuration
 *
 * Optimized for fast route transitions with:
 * - Intent-based preloading (loads on hover/focus)
 * - Aggressive preload timing (150ms delay)
 * - Stale time for cached route data (30s)
 * - Scroll restoration for back/forward navigation
 * - Not found handling
 */
export function createRouter() {
  const router = createTanStackRouter({
    routeTree,

    // Preload routes when user shows intent (hover/focus on links)
    defaultPreload: 'intent',

    // Preload after 150ms of hover/focus (fast but prevents accidental loads)
    defaultPreloadDelay: 150,

    // Keep preloaded route data fresh for 30 seconds
    defaultPreloadStaleTime: 30_000,

    // Route data is stale after 5 minutes (for loader data)
    defaultStaleTime: 5 * 60 * 1000,

    // Restore scroll position on back/forward navigation
    scrollRestoration: true,

    // Use structural sharing to minimize re-renders
    defaultStructuralSharing: true,

    // Default not found configuration
    notFoundMode: 'root',
  })

  return router
}

// Singleton router instance
let router: ReturnType<typeof createRouter> | undefined

export function getRouter() {
  if (!router) {
    router = createRouter()
  }
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
