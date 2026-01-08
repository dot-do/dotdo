import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { apiRoutes } from './routes/api'
import { mcpRoutes } from './routes/mcp'
import { rpcRoutes } from './routes/rpc'
import { errorHandler, notFoundHandler } from './middleware/error-handling'

// Types for Cloudflare Workers bindings
export interface Env {
  KV: KVNamespace
  DO: DurableObjectNamespace
  TEST_KV: KVNamespace
  TEST_DO: DurableObjectNamespace
  ASSETS: Fetcher
}

// Create the Hono app
export const app = new Hono<{ Bindings: Env }>()

// Global middleware
app.use('*', errorHandler)
app.use('*', logger())
app.use('*', cors())

// Root route - serves HTML
app.get('/', (c) => {
  return c.html('<!DOCTYPE html><html><head><title>do.md</title></head><body><h1>do.md</h1></body></html>')
})

// Health check endpoint - GET only
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})

// Return 405 for other methods on health endpoint
app.all('/api/health', (c) => {
  return c.json({ error: 'Method not allowed', allowed: ['GET'] }, 405)
})

// Mount API routes
app.route('/api', apiRoutes)

// Mount MCP routes
app.route('/mcp', mcpRoutes)

// Mount RPC routes
app.route('/rpc', rpcRoutes)

// Catch-all for unknown routes
app.all('*', notFoundHandler)

// Export the app with fetch handler
export default app
