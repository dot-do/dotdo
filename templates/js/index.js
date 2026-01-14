import { Hono } from 'hono'
import { DurableObject } from 'cloudflare:workers'

// Your App - a stateful, AI-native backend at the edge
export class App extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url)

    // Built-in SQLite database - no setup required
    const result = this.ctx.storage.sql
      .exec('SELECT value FROM kv WHERE key = ?', 'visits')
      .toArray()[0]
    const count = result?.value ?? 0

    if (url.pathname === '/increment') {
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)',
        'visits', count + 1
      )
      return Response.json({ visits: count + 1 })
    }

    return Response.json({ visits: count, message: 'Welcome to your .do app!' })
  }
}

// Edge-native API routing
const app = new Hono()

app.get('/', (c) => c.json({ app: 'my-do-app', status: 'running' }))

app.all('/app/:id/*', async (c) => {
  const stub = c.env.DO.get(c.env.DO.idFromName(c.req.param('id')))
  return stub.fetch(c.req.raw)
})

export default app
