/**
 * dotdo App - Static MDX-based Application Framework
 *
 * Provides a complete, ready-to-deploy application with:
 * - Landing page rendered from Site.mdx at root
 * - Dashboard app rendered from App.mdx
 * - Documentation from docs/ folder via fumadocs-mdx
 *
 * ## Usage
 *
 * Consumers can deploy by simply re-exporting:
 *
 * @example Basic deployment
 * ```ts
 * // worker.ts
 * import { app } from 'dotdo/app'
 * export default app
 * ```
 *
 * @example With custom MDX files
 * ```
 * your-project/
 *   Site.mdx      # Landing page content
 *   App.mdx       # Dashboard content
 *   docs/         # Documentation (fumadocs-mdx)
 *   worker.ts     # import { app } from 'dotdo/app'
 *   wrangler.jsonc
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
 *
 * ## MDX Components Available
 *
 * In Site.mdx:
 * - AgentGrid, Agent - Display team agents
 * - FeatureGrid, Feature - Display features
 * - CTA - Call to action buttons
 * - Hero, Section, CodeBlock - Layout components
 *
 * In App.mdx:
 * - DashboardLayout, Sidebar, DashboardContent
 * - KPICard, ActivityFeed, AgentStatus
 * - DataTable, Tabs, Charts
 * - SettingsLayout, SettingsSection
 *
 * @see https://dotdo.dev/docs/app
 */

import { Hono } from 'hono'

export interface AppEnv {
  ASSETS?: Fetcher
  // Add other bindings as needed
}

/**
 * The dotdo application.
 *
 * This is a Hono app that:
 * 1. Serves the static site built from MDX files
 * 2. Provides API routes for the application
 * 3. Can be extended with additional routes
 *
 * ## Route Structure
 * - `/` - Landing page (from Site.mdx)
 * - `/app` - Dashboard (from App.mdx)
 * - `/docs` - Documentation (from docs/ folder)
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
