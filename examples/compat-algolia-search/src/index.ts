/**
 * Algolia Search Compat - Worker Entry Point
 *
 * Routes requests to the SearchDO Durable Object for full-text search.
 *
 * Endpoints:
 * - POST /index - Index products
 * - GET /search?q=query - Search products
 * - GET /instant?q=query - Instant search (autocomplete)
 * - GET /facets - Get facet counts
 * - GET /products/:id - Get single product
 * - DELETE /products/:id - Delete product
 * - POST /settings - Update index settings
 * - GET /stats - Get index statistics
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the Durable Object class
export { SearchDO } from './SearchDO'

// ============================================================================
// TYPES
// ============================================================================

interface Env {
  SEARCH_DO: DurableObjectNamespace
  ENVIRONMENT?: string
}

// ============================================================================
// APP
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for browser access
app.use('*', cors())

// Health check
app.get('/', (c) => {
  return c.json({
    service: 'compat-algolia-search',
    version: '0.1.0',
    status: 'healthy',
    docs: 'https://dotdo.dev/compat/algolia'
  })
})

// Route all other requests to the SearchDO
app.all('*', async (c) => {
  const env = c.env

  // Get the DO stub - use a fixed ID for single-tenant or derive from request
  const id = env.SEARCH_DO.idFromName('default')
  const stub = env.SEARCH_DO.get(id)

  // Forward the request to the DO
  return stub.fetch(c.req.raw)
})

export default app
