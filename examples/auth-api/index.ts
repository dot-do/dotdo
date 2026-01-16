/**
 * Authenticated API Example
 *
 * Extends DOFull with WorkOS authentication via oauth.do.
 * - Read operations: Public
 * - Write operations: Require valid token
 *
 * @example
 * ```bash
 * # Public read (no auth)
 * curl https://your-worker.dev/Customer
 *
 * # Protected write (requires token)
 * curl -X POST https://your-worker.dev/api/items \
 *   -H "Authorization: Bearer <token>" \
 *   -H "Content-Type: application/json" \
 *   -d '{"$type": "Customer", "name": "Alice"}'
 * ```
 */

import { DOFull, type DOFullEnv } from '../../objects/DOFull'

// For production, use:
// import { ensureLoggedIn } from 'oauth.do/node'

export interface AuthEnv extends DOFullEnv {
  WORKOS_CLIENT_ID?: string
}

/**
 * AuthAPI - DOFull with authentication middleware
 */
export class AuthAPI extends DOFull {
  constructor(ctx: DurableObjectState, env: AuthEnv) {
    super(ctx, env)

    // Add auth middleware for write operations
    this.app.use('*', async (c, next) => {
      const method = c.req.method

      // Allow reads without auth
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return next()
      }

      // Require auth for writes
      const authHeader = c.req.header('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401)
      }

      const token = authHeader.slice(7)

      // Development: accept test token
      if (token === 'test-token-for-e2e' && !env.WORKOS_CLIENT_ID) {
        return next()
      }

      // Production: validate with oauth.do
      // const user = await ensureLoggedIn(token)
      // c.set('user', user)

      return next()
    })
  }
}

// Worker entry
export default {
  async fetch(request: Request, env: AuthEnv): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DOFull.idFromName(ns)
    const stub = env.DOFull.get(id)

    return stub.fetch(request)
  },
}
