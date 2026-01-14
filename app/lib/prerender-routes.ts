/**
 * Prerender Routes Configuration
 *
 * Generates a list of all routes that should be statically prerendered.
 * This includes all docs pages and static marketing pages.
 *
 * Routes that are NOT prerendered:
 * - /admin/* - Requires authentication
 * - /app/* - Requires authentication
 * - /login - Dynamic auth flow
 *
 * @see internal/plans/2026-01-12-fumadocs-static-prerender-design.md
 */

import { getAllPages } from './source'

/**
 * Static routes that are always prerendered (non-docs)
 */
export const staticRoutes = [
  '/',
  '/docs',
  '/docs/getting-started',
]

/**
 * Get all docs routes for prerendering
 * Returns an array of URL paths like ['/docs/concepts/things', '/docs/api/routes']
 */
export function getDocsRoutes(): string[] {
  try {
    const pages = getAllPages()
    return pages.map((page) => page.url)
  } catch (error) {
    console.warn('Failed to get docs routes for prerendering:', error)
    // Return empty array to allow build to continue
    return []
  }
}

/**
 * Get all routes that should be prerendered
 */
export function getPrerenderRoutes(): string[] {
  const docsRoutes = getDocsRoutes()
  return [...staticRoutes, ...docsRoutes]
}

/**
 * Filter function to exclude routes that shouldn't be prerendered
 */
export function shouldPrerender(path: string): boolean {
  // Skip admin routes (require auth)
  if (path.startsWith('/admin')) return false

  // Skip app routes (require auth)
  if (path.startsWith('/app')) return false

  // Skip login (dynamic)
  if (path === '/login') return false

  // Skip API routes
  if (path.startsWith('/api')) return false

  // Prerender everything else
  return true
}
