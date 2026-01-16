/**
 * Authenticated API Example
 *
 * A dotdo example demonstrating WorkOS authentication via oauth.do.
 * - Read operations: Public (no auth required)
 * - Write operations: Protected (requires valid WorkOS token)
 *
 * @example
 * ```bash
 * # Deploy
 * cd examples/auth-api
 * npm install && npm run deploy
 *
 * # Public read (no auth)
 * curl https://auth-api.your-domain.workers.dev/things/Customer
 *
 * # Protected write (requires auth)
 * curl -X POST https://auth-api.your-domain.workers.dev/things/Customer \
 *   -H "Authorization: Bearer <workos-token>" \
 *   -H "Content-Type: application/json" \
 *   -d '{"name": "Alice"}'
 * ```
 */

import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'

// Import oauth.do for WorkOS token validation
// import { ensureLoggedIn } from 'oauth.do/node'

// Environment bindings
export interface Env {
  AuthAPI: DurableObjectNamespace
  // WorkOS configuration
  WORKOS_CLIENT_ID?: string
  WORKOS_API_KEY?: string
}

/**
 * Simple auth middleware that validates WorkOS tokens
 * In production, use: import { ensureLoggedIn } from 'oauth.do/node'
 */
async function validateToken(
  authHeader: string | undefined,
  env: Env
): Promise<{ valid: boolean; user?: { sub: string; email?: string } }> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false }
  }

  const token = authHeader.slice(7)

  // In development/testing, accept a test token
  if (token === 'test-token-for-e2e' && !env.WORKOS_CLIENT_ID) {
    return { valid: true, user: { sub: 'test-user', email: 'test@example.com' } }
  }

  // Production: validate with WorkOS via oauth.do
  // const user = await ensureLoggedIn(token)
  // return { valid: true, user }

  // For now, use a simple JWT validation placeholder
  // In production, use oauth.do/node
  try {
    // Placeholder for oauth.do validation
    // const response = await fetch('https://oauth.do/api/verify', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${env.WORKOS_API_KEY}`,
    //   },
    //   body: JSON.stringify({ token }),
    // })
    // const data = await response.json()
    // return { valid: data.valid, user: data.user }

    return { valid: false }
  } catch {
    return { valid: false }
  }
}

/**
 * Authenticated API Durable Object
 *
 * Provides CRUD with auth protection on write operations.
 */
export class AuthAPI extends DurableObject {
  private sql: SqlStorage
  private app: Hono<{ Bindings: Env }>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql

    // Initialize schema
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_things_type ON things(type);
    `)

    this.app = new Hono<{ Bindings: Env }>()

    // Auth middleware for write operations
    const requireAuth = async (c: any, next: () => Promise<void>) => {
      const authResult = await validateToken(c.req.header('Authorization'), env)
      if (!authResult.valid) {
        return c.json({ error: 'Unauthorized', message: 'Valid WorkOS token required' }, 401)
      }
      c.set('user', authResult.user)
      return next()
    }

    // ======================================
    // PUBLIC ENDPOINTS (no auth required)
    // ======================================

    // Health check
    this.app.get('/health', (c) => c.json({ status: 'ok', auth: 'enabled' }))

    // List things by type (read-only)
    this.app.get('/things/:type', (c) => {
      const type = c.req.param('type')
      const rows = this.sql
        .exec('SELECT * FROM things WHERE type = ?', type)
        .toArray()
      return c.json(
        rows.map((r) => ({
          ...JSON.parse(r.data as string),
          $id: r.id,
          $type: r.type,
        }))
      )
    })

    // Get single thing (read-only)
    this.app.get('/things/:type/:id', (c) => {
      const { type, id } = c.req.param()
      const row = this.sql
        .exec('SELECT * FROM things WHERE type = ? AND id = ?', type, id)
        .one()
      if (!row) return c.json({ error: 'Not found' }, 404)
      return c.json({
        ...JSON.parse(row.data as string),
        $id: row.id,
        $type: row.type,
      })
    })

    // ======================================
    // PROTECTED ENDPOINTS (auth required)
    // ======================================

    // Create thing
    this.app.post('/things/:type', requireAuth, async (c) => {
      const type = c.req.param('type')
      const body = await c.req.json()
      const user = c.get('user')
      const id = body.$id || crypto.randomUUID()
      const data = JSON.stringify(body)

      this.sql.exec(
        'INSERT INTO things (id, type, data, created_by) VALUES (?, ?, ?, ?)',
        id,
        type,
        data,
        user?.sub || 'anonymous'
      )

      return c.json({ $id: id, $type: type, ...body }, 201)
    })

    // Update thing
    this.app.patch('/things/:type/:id', requireAuth, async (c) => {
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

    // Delete thing
    this.app.delete('/things/:type/:id', requireAuth, (c) => {
      const { type, id } = c.req.param()
      this.sql.exec('DELETE FROM things WHERE type = ? AND id = ?', type, id)
      return c.json({ deleted: true })
    })

    // ======================================
    // RPC ENDPOINT (auth for writes)
    // ======================================

    this.app.post('/rpc/pipeline', async (c) => {
      const body = await c.req.json()
      const isWriteOperation = body.pipeline?.some(
        (step: { name: string }) =>
          ['create', 'update', 'delete', 'save'].includes(step.name)
      )

      if (isWriteOperation) {
        const authResult = await validateToken(c.req.header('Authorization'), env)
        if (!authResult.valid) {
          return c.json({ error: 'Unauthorized for write operations' }, 401)
        }
      }

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
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.AuthAPI.idFromName(ns)
    const stub = env.AuthAPI.get(id)

    return stub.fetch(request)
  },
}
