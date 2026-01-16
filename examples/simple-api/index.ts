/**
 * Simple API Example
 *
 * A minimal dotdo example for E2E testing the RPC client.
 * Demonstrates both unauthenticated (read-only) and authenticated access.
 *
 * @example
 * ```bash
 * # Deploy
 * cd examples/simple-api
 * npm install && npm run deploy
 *
 * # Test unauthenticated read
 * curl https://simple-api.your-domain.workers.dev/things
 *
 * # Test RPC client
 * import { createRPCClient } from '@dotdo/core'
 * const api = createRPCClient({ target: 'https://simple-api.your-domain.workers.dev' })
 * const customers = await api.things.list('Customer')
 * ```
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'

// Environment bindings
export interface Env {
  SimpleAPI: DurableObjectNamespace
  // Optional: oauth.do auth binding
  // AUTH?: { verify: (token: string) => Promise<{ sub: string }> }
}

/**
 * Simple API Durable Object
 *
 * Provides basic CRUD operations on Things with optional auth.
 */
export class SimpleAPI extends DurableObject {
  private sql: SqlStorage
  private app: Hono

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql

    // Initialize schema
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
    `)

    // Set up Hono router
    this.app = new Hono()

    // Health check (always public)
    this.app.get('/health', (c) => c.json({ status: 'ok' }))

    // List things by type (read-only, no auth required)
    this.app.get('/things/:type', (c) => {
      const type = c.req.param('type')
      const rows = this.sql
        .exec('SELECT * FROM things WHERE type = ?', type)
        .toArray()
      return c.json(rows.map((r) => ({ ...JSON.parse(r.data as string), $id: r.id, $type: r.type })))
    })

    // Get single thing (read-only, no auth required)
    this.app.get('/things/:type/:id', (c) => {
      const { type, id } = c.req.param()
      const row = this.sql
        .exec('SELECT * FROM things WHERE type = ? AND id = ?', type, id)
        .one()
      if (!row) return c.json({ error: 'Not found' }, 404)
      return c.json({ ...JSON.parse(row.data as string), $id: row.id, $type: row.type })
    })

    // Create thing (write, auth optional based on config)
    this.app.post('/things/:type', async (c) => {
      const type = c.req.param('type')
      const body = await c.req.json()
      const id = body.$id || crypto.randomUUID()
      const data = JSON.stringify(body)

      this.sql.exec(
        'INSERT INTO things (id, type, data) VALUES (?, ?, ?)',
        id,
        type,
        data
      )

      return c.json({ $id: id, $type: type, ...body }, 201)
    })

    // Update thing (write, auth optional based on config)
    this.app.patch('/things/:type/:id', async (c) => {
      const { type, id } = c.req.param()
      const body = await c.req.json()

      const existing = this.sql
        .exec('SELECT data FROM things WHERE type = ? AND id = ?', type, id)
        .one()

      if (!existing) return c.json({ error: 'Not found' }, 404)

      const merged = { ...JSON.parse(existing.data as string), ...body }
      this.sql.exec(
        'UPDATE things SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE type = ? AND id = ?',
        JSON.stringify(merged),
        type,
        id
      )

      return c.json({ $id: id, $type: type, ...merged })
    })

    // Delete thing (write, auth optional based on config)
    this.app.delete('/things/:type/:id', (c) => {
      const { type, id } = c.req.param()
      this.sql.exec('DELETE FROM things WHERE type = ? AND id = ?', type, id)
      return c.json({ deleted: true })
    })

    // RPC endpoint for pipelining
    this.app.post('/rpc/pipeline', async (c) => {
      const body = await c.req.json()
      // Pipeline execution would be handled here
      // For now, return a simple response
      return c.json({ result: body, executed: true })
    })
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}

// Worker entry point
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Extract namespace from subdomain or use 'default'
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    // Get or create DO instance
    const id = env.SimpleAPI.idFromName(ns)
    const stub = env.SimpleAPI.get(id)

    return stub.fetch(request)
  },
}
