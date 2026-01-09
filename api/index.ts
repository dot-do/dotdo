import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { apiRoutes } from './routes/api'
import { mcpRoutes } from './routes/mcp'
import { rpcRoutes } from './routes/rpc'
import { browsersRoutes } from './routes/browsers'
import { getOpenAPIDocument } from './routes/openapi'
import { errorHandler } from './middleware/error-handling'
import { requestIdMiddleware } from './middleware/request-id'
import { landingPageHtml, docsPageHtml, adminDashboardHtml, adminLoginHtml, adminUsersHtml, adminUserNewHtml, adminWorkflowsHtml, adminIntegrationsHtml, adminApiKeysHtml, adminSettingsHtml, adminSettingsAccountHtml, adminSettingsSecurityHtml, adminActivityHtml, notFoundHtml } from './pages'

// Re-export Durable Object classes for wrangler
export { TestDurableObject } from './test-do'
export { DurableObject } from 'cloudflare:workers'
export { Browser } from '../objects/Browser'

// Types for Cloudflare Workers bindings
export interface Env {
  KV: KVNamespace
  DO: DurableObjectNamespace
  BROWSER_DO: DurableObjectNamespace
  TEST_KV: KVNamespace
  TEST_DO: DurableObjectNamespace
  ASSETS: Fetcher
}

// Create the Hono app
export const app = new Hono<{ Bindings: Env }>()

// Global middleware
app.use('*', errorHandler)
app.use('*', requestIdMiddleware)
app.use('*', logger())
app.use('*', cors())

// Landing page
app.get('/', (c) => {
  return c.html(landingPageHtml())
})

// Documentation routes
app.get('/docs', (c) => {
  return c.html(docsPageHtml('index'))
})
app.get('/docs/', (c) => {
  return c.html(docsPageHtml('index'))
})
app.get('/docs/getting-started', (c) => {
  return c.html(docsPageHtml('getting-started'))
})
app.get('/docs/api', (c) => {
  return c.html(docsPageHtml('api'))
})
app.get('/docs/*', (c) => {
  const path = c.req.path.replace('/docs/', '')
  return c.html(docsPageHtml(path))
})

// Admin routes
app.get('/admin', (c) => {
  return c.html(adminDashboardHtml())
})
app.get('/admin/', (c) => {
  return c.html(adminDashboardHtml())
})
app.get('/admin/login', (c) => {
  return c.html(adminLoginHtml())
})
app.get('/admin/users', (c) => {
  return c.html(adminUsersHtml())
})
app.get('/admin/users/', (c) => {
  return c.html(adminUsersHtml())
})
app.get('/admin/users/new', (c) => {
  return c.html(adminUserNewHtml())
})
app.get('/admin/users/:id', (c) => {
  return c.html(adminUsersHtml())
})
app.get('/admin/workflows', (c) => {
  return c.html(adminWorkflowsHtml())
})
app.get('/admin/workflows/', (c) => {
  return c.html(adminWorkflowsHtml())
})
app.get('/admin/workflows/:id', (c) => {
  return c.html(adminWorkflowsHtml())
})
app.get('/admin/workflows/:id/runs', (c) => {
  return c.html(adminWorkflowsHtml())
})
app.get('/admin/integrations', (c) => {
  return c.html(adminIntegrationsHtml())
})
app.get('/admin/integrations/', (c) => {
  return c.html(adminIntegrationsHtml())
})
app.get('/admin/integrations/api-keys', (c) => {
  return c.html(adminApiKeysHtml())
})
app.get('/admin/settings', (c) => {
  return c.html(adminSettingsHtml())
})
app.get('/admin/settings/', (c) => {
  return c.html(adminSettingsHtml())
})
app.get('/admin/settings/account', (c) => {
  return c.html(adminSettingsAccountHtml())
})
app.get('/admin/settings/security', (c) => {
  return c.html(adminSettingsSecurityHtml())
})
app.get('/admin/activity', (c) => {
  return c.html(adminActivityHtml())
})
app.get('/admin/activity/', (c) => {
  return c.html(adminActivityHtml())
})

// Handle /api/ explicitly (trailing slash)
app.get('/api/', (c) => {
  return c.json({
    name: 'dotdo',
    version: '0.0.1',
    endpoints: ['/api/health', '/api/things'],
  })
})

// OpenAPI spec endpoint
app.get('/api/openapi.json', (c) => {
  const spec = getOpenAPIDocument()
  return c.json(spec, 200, {
    'Access-Control-Allow-Origin': '*',
  })
})

// Mount API routes
app.route('/api', apiRoutes)

// Mount Browser API routes
app.route('/api/browsers', browsersRoutes)

// Mount MCP routes
app.route('/mcp', mcpRoutes)

// Mount RPC routes
app.route('/rpc', rpcRoutes)

// Catch-all for unknown routes - return 404 HTML page
app.all('*', (c) => {
  // API routes should return JSON 404
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Not found: ${c.req.path}` } }, 404)
  }
  // All other routes return HTML 404 page
  return c.html(notFoundHtml(), 404)
})

// Export the app with fetch handler
export default app
