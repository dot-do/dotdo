/**
 * @fileoverview gitx-do Worker Entry Point
 *
 * Production entry point for the gitx-do Cloudflare Worker.
 * Exports the Durable Object classes and provides a default fetch handler
 * that routes requests to the appropriate DO.
 *
 * @module gitx.do/worker
 */

import { Hono } from 'hono'
import { GitRepoDO } from './do/GitRepoDO'

// ============================================================================
// Environment Interface
// ============================================================================

interface Env {
  // Durable Object namespaces
  GITX: DurableObjectNamespace

  // R2 buckets
  R2: R2Bucket
  PACK_STORAGE: R2Bucket

  // Service bindings
  FSX?: Fetcher
  BASHX?: Fetcher
}

// ============================================================================
// Router Setup
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'gitx-do',
    timestamp: new Date().toISOString(),
  })
})

// Route to GitRepoDO by namespace
// Pattern: /:namespace/* - routes to a DO instance keyed by namespace
app.all('/:namespace/*', async (c) => {
  const namespace = c.req.param('namespace')
  const id = c.env.GITX.idFromName(namespace)
  const stub = c.env.GITX.get(id)

  // Strip the namespace prefix from the path
  const url = new URL(c.req.url)
  const newPath = url.pathname.replace(`/${namespace}`, '') || '/'
  const newUrl = new URL(newPath, url.origin)
  newUrl.search = url.search

  return stub.fetch(new Request(newUrl.toString(), c.req.raw))
})

// Default route - root health check
app.get('/', (c) => {
  return c.json({
    name: 'gitx-do',
    version: '0.1.0',
    description: 'Git implementation for Cloudflare Durable Objects',
    endpoints: {
      health: '/health',
      repo: '/:namespace/*',
    },
  })
})

// ============================================================================
// Exports
// ============================================================================

export default app

// Export Durable Object classes for Wrangler
export { GitRepoDO }
