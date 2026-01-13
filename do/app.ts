/**
 * dotdo App - Ready-to-deploy dashboard application
 *
 * Exports a Hono app that serves the dotdo dashboard.
 * Consumers can deploy by simply re-exporting:
 *
 * @example
 * ```ts
 * // worker.ts
 * import { app } from 'dotdo/app'
 * export default app
 * ```
 *
 * Configure wrangler.jsonc to serve static assets:
 * ```json
 * {
 *   "assets": {
 *     "directory": "./node_modules/dotdo/app/dist"
 *   }
 * }
 * ```
 */

import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'

export interface AppEnv {
  ASSETS?: Fetcher
  // Add other bindings as needed
}

/**
 * The dotdo dashboard application.
 *
 * This is a Hono app that:
 * 1. Serves static assets from the app/dist directory
 * 2. Provides API routes for the dashboard
 * 3. Can be extended with additional routes
 */
export const app = new Hono<{ Bindings: AppEnv }>()

// Serve static assets if ASSETS binding is available
app.get('/assets/*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw)
  }
  return c.notFound()
})

// Serve index.html for SPA routing
app.get('*', async (c) => {
  if (c.env.ASSETS) {
    // Try to serve the exact path first
    const response = await c.env.ASSETS.fetch(c.req.raw)
    if (response.ok) {
      return response
    }
    // Fall back to index.html for SPA routing
    const indexUrl = new URL('/index.html', c.req.url)
    return c.env.ASSETS.fetch(new Request(indexUrl, c.req.raw))
  }
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head><title>dotdo</title></head>
      <body>
        <h1>dotdo Dashboard</h1>
        <p>Configure ASSETS binding in wrangler.jsonc to serve the dashboard.</p>
        <pre>
{
  "assets": {
    "directory": "./node_modules/dotdo/app/dist"
  }
}
        </pre>
      </body>
    </html>
  `)
})

export default app
