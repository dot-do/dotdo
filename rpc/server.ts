// RPC Server - exposes methods via HTTP/RPC
import { Hono } from 'hono'

export interface RPCServerOptions {
  target: object
}

export interface RPCRequest {
  method: string
  args: unknown[]
}

export function createServer(options: RPCServerOptions) {
  const { target } = options
  const app = new Hono()

  // RPC endpoint
  app.post('/rpc', async (c) => {
    try {
      const { method, args } = await c.req.json<RPCRequest>()

      // Navigate nested paths (e.g., "users.create")
      const parts = method.split('.')
      let current: any = target

      for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]]
        if (!current) {
          return c.json({ error: `Method not found: ${method}` }, 404)
        }
      }

      const fn = current[parts[parts.length - 1]]
      if (typeof fn !== 'function') {
        return c.json({ error: `Method not found: ${method}` }, 404)
      }

      const result = await fn.apply(current, args)
      return c.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return c.json({ error: message }, 500)
    }
  })

  // Health check
  app.get('/', (c) => c.json({ status: 'ok' }))

  return app
}

// Cloudflare Worker export helper
export function createWorkerFromTarget(target: object) {
  const app = createServer({ target })

  return {
    fetch: app.fetch.bind(app)
  }
}
