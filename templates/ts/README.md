# my-do-app

> You're about to build something incredible.

## What You Get

This isn't just a starter template. It's your launchpad to building production-ready apps that would normally take months—in minutes.

**Out of the box:**

- **Database** — SQLite per instance, zero config, infinite scale
- **Auth** — Login with org.ai (humans + AI agents)
- **API** — Type-safe endpoints with Hono
- **Admin** — Built-in dashboard at /admin
- **Docs** — Auto-generated API documentation
- **SDK** — TypeScript client for your API
- **CLI** — Command-line interface for your app
- **MCP** — AI-native Model Context Protocol support

## Quick Start

```bash
npm run dev
```

Visit `http://localhost:8787` — your app is running.

## Deploy

```bash
npm run deploy
```

That's it. Your app is live on Cloudflare's global edge network.

## The Magic

Every instance of your app gets:
- Its own SQLite database
- WebSocket connections
- Durable state that never loses data
- Sub-millisecond latency worldwide

```typescript
// Your app is stateful by default
const count = this.ctx.storage.sql.exec('SELECT value FROM kv WHERE key = ?', 'visits')
```

## Add Auth

```bash
npm install org.ai
```

```typescript
import { auth } from 'org.ai'

// Authenticate humans and AI agents
const user = await auth(request)
```

## Add AI

```typescript
// Your DO can respond to AI agents via MCP
export class App extends DurableObject {
  async mcp(tool: string, args: unknown) {
    // Handle AI tool calls
  }
}
```

## What's Next?

You have everything you need. Now go build something amazing.

- [Documentation](https://do.md)
- [Examples](https://github.com/drivly/dotdo/examples)
- [Community](https://discord.gg/dotdo)

---

Built with [dotdo](https://do.md) — the platform for AI-native apps.
