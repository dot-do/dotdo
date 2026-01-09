import { createRouter as createTanStackRouter } from '@tanstack/react-router'
// @ts-ignore - Generated file
import { routeTree } from './routeTree.gen'

export function createRouter() {
  const router = createTanStackRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
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
