# 5-Minute Quickstart

Get a Durable Object running locally in under 5 minutes.

## Prerequisites

- Node.js 18+ (`node --version`)
- Cloudflare account (free tier works for local dev)

## 1. Create Project

```bash
npx dotdo init my-app
cd my-app
npm install
```

This scaffolds:
- `src/index.ts` - Worker entry point
- `src/my-do.ts` - Your Durable Object class
- `wrangler.toml` - Cloudflare configuration
- `vitest.config.ts` - Test setup

## 2. Start Dev Server

```bash
npm run dev
```

Your app is now running at `http://localhost:8787`.

## 3. Test Your DO

```bash
# Health check
curl http://localhost:8787/default/

# Create a Thing (entity)
curl -X POST http://localhost:8787/default/things \
  -H "Content-Type: application/json" \
  -d '{"$type": "Task", "title": "Hello World", "done": false}'

# List Things
curl http://localhost:8787/default/things
```

You should see your Task returned with an auto-generated `$id`.

## 4. Customize Your DO

Edit `src/my-do.ts`:

```typescript
import { DO } from 'dotdo'

export class MyDO extends DO {
  // Add custom routes
  protected routes(app: typeof this.app): void {
    app.get('/hello', (c) => {
      return c.json({ message: 'Hello from dotdo!' })
    })

    app.post('/tasks', async (c) => {
      const { title } = await c.req.json()
      const task = await this.things.create({
        $type: 'Task',
        title,
        done: false
      })
      return c.json(task, 201)
    })
  }

  // Add RPC methods (callable from other DOs)
  async createTask(title: string) {
    return this.things.create({
      $type: 'Task',
      title,
      done: false
    })
  }
}
```

Save and test:

```bash
curl http://localhost:8787/default/hello
# {"message":"Hello from dotdo!"}

curl -X POST http://localhost:8787/default/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "My first task"}'
```

## 5. Deploy to Cloudflare

First, authenticate with Cloudflare:

```bash
wrangler login
```

Then deploy:

```bash
npm run deploy
```

Your app is now live at `https://my-app.<your-subdomain>.workers.dev`.

## What You Built

- A globally distributed Durable Object with SQLite storage
- REST API endpoints with automatic CORS
- Entity storage with `this.things` (no schema required)
- RPC methods callable from Workers or other DOs

## Next Steps

| Want to... | Read... |
|------------|---------|
| Add more entities | [GETTING_STARTED.md - Storage](./docs/GETTING_STARTED.md#adding-storage-with-sqlite) |
| Add WebSocket support | [GETTING_STARTED.md - WebSocket](./docs/GETTING_STARTED.md#adding-websocket-support) |
| Call other DOs | [README.md - $ Context](./README.md#the--context) |
| Run tests | [GETTING_STARTED.md - Testing](./docs/GETTING_STARTED.md#testing) |
| Learn architecture | [CLAUDE.md](./CLAUDE.md) |

## Quick Reference

```bash
npm run dev       # Start local server
npm test          # Run tests
npm run deploy    # Deploy to Cloudflare
wrangler tail     # View production logs
```

## Common Patterns

```typescript
// Entity CRUD
await this.things.create({ $type: 'User', name: 'Alice' })
await this.things.get('usr_abc123')
await this.things.update('usr_abc123', { name: 'Bob' })
await this.things.delete('usr_abc123')
await this.things.list({ $type: 'User' })

// Event handlers
this.$.on.User.created(async (event) => {
  await sendWelcomeEmail(event.email)
})

// Scheduled tasks
this.$.every.day.at('9am')(async () => {
  await generateDailyReport()
})

// Cross-DO RPC
await this.$.Order('order-123').ship()
```

---

**Need help?** Check [Troubleshooting](./docs/TROUBLESHOOTING.md) or join our [Discord](https://workers.do/discord).
