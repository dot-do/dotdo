# my-do-app

> Build your vision. Ship it today.

## The Problem You're Solving

You have an idea. But between you and shipping are weeks of:
- Setting up databases
- Implementing authentication
- Building admin dashboards
- Writing documentation
- Creating SDKs
- Deploying infrastructure

**What if all of that was already done?**

## Your Solution

```bash
npm run dev
```

You now have:

| Feature | Status | Description |
|---------|--------|-------------|
| **Database** | Ready | SQLite per instance, infinite scale |
| **Auth** | Ready | Humans + AI agents with org.ai |
| **Website** | Ready | Your content, beautifully rendered |
| **Admin** | Ready | Dashboard at /admin |
| **API** | Ready | Type-safe, auto-documented |
| **Docs** | Ready | Generated from your code |
| **SDK** | Ready | TypeScript client included |
| **CLI** | Ready | Command-line for power users |
| **MCP** | Ready | AI agents can use your app |

## Deploy Worldwide

```bash
npm run deploy
```

Your app is now live on 300+ edge locations. Sub-millisecond latency. Infinite scale. Zero ops.

## The Architecture

```
Your App
├── content/        → Your website (HTML, MDX, assets)
├── worker.ts       → Your API + Durable Object
└── wrangler.jsonc  → Your config
```

That's it. Three things to understand. Everything else is handled.

## Add Features in Seconds

**Auth:**
```typescript
import { auth } from 'org.ai'
const user = await auth(request)  // Humans or AI agents
```

**Payments:**
```typescript
import { stripe } from 'org.ai/auth'
const checkout = await stripe.createCheckout(user)
```

**AI:**
```typescript
// Your DO responds to AI tool calls via MCP
async mcp(tool: string, args: unknown) {
  // Handle AI requests
}
```

## What You're Building

You're not building a toy. You're building:
- A SaaS that scales to millions
- An AI-native platform that agents can use
- A business that runs itself

## Go Build

The infrastructure is done. The patterns are proven. The platform is ready.

**Now it's your turn.**

- [Documentation](https://do.md)
- [Examples](https://github.com/drivly/dotdo/examples)
- [Community](https://discord.gg/dotdo)

---

Built with [dotdo](https://do.md) — where ideas become products.
