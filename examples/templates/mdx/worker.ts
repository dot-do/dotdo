import { Hono } from 'hono'
import { DurableObject } from 'cloudflare:workers'

// Your App - content-first, AI-native
export class App extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Built-in SQLite database
    const visits = this.ctx.storage.sql
      .exec('SELECT value FROM kv WHERE key = ?', 'visits')
      .toArray()[0]?.value as number ?? 0

    if (url.pathname === '/api/visit') {
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)',
        'visits', visits + 1
      )
      return Response.json({ visits: visits + 1 })
    }

    return Response.json({ visits })
  }
}

interface Env {
  DO: DurableObjectNamespace<App>
  ASSETS: Fetcher
}

const app = new Hono<{ Bindings: Env }>()

// API routes
app.get('/api', (c) => c.json({ app: 'my-do-app', status: 'running' }))

app.all('/api/:id/*', async (c) => {
  const stub = c.env.DO.get(c.env.DO.idFromName(c.req.param('id')))
  return stub.fetch(c.req.raw)
})

// Serve MDX content
app.get('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw)
})

export default app
