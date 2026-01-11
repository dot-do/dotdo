# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is dotdo?

**Build your 1-Person Unicorn.** Business-as-Code framework for autonomous businesses run by AI agents.

```typescript
import { Startup } from 'dotdo'
import { priya, ralph, tom, mark, sally } from 'agents.do'

export class MyStartup extends Startup {
  async launch() {
    const spec = priya`define the MVP for ${this.hypothesis}`
    let app = ralph`build ${spec}`

    do {
      app = ralph`improve ${app} per ${tom}`
    } while (!await tom.approve(app))

    mark`announce the launch`
    sally`start selling`
  }
}
```

## Core Architecture

**V8 Isolates + Durable Objects:** Virtual Chrome tabs with persistent state, running on edge (300+ cities, 0ms cold starts).

**Cap'n Web RPC (partial):** Promise pipelining integration with `capnweb`. Core infrastructure exists; full Magic Map planned.

**Extended Primitives:** fsx (filesystem on SQLite), gitx (Git on R2), bashx (shell without VMs) - implemented as separate packages in `primitives/`.

**Compat SDKs (15 implemented):** algolia, benthos, couchdb, duckdb, emails, postgres, pusher, sendgrid, sentry, sqs, stripe, supabase, supabase-auth. Additional SDKs (mongo, kafka, redis, etc.) planned.

## Commands

```bash
npm run dev          # Wrangler dev server
npm run dev:app      # App dev server
npm test             # Vitest watch mode
npm run test:run     # Tests once
npm run typecheck    # TypeScript check
npm run deploy       # Build + deploy
```

### Running Tests

```bash
npx vitest run path/to/test.ts        # Single file
npx vitest --project=workers          # Workers runtime
npx vitest --project=compat           # Compat layers
npx vitest --project=agents           # Agent SDK
```

## Architecture

```
api/           # Hono HTTP (routes/, middleware/)
objects/       # DO classes (DO.ts, Worker.ts, Entity.ts, Startup.ts)
types/         # Thing, Noun, Verb, WorkflowContext
db/            # Drizzle schemas, iceberg/, edgevec/, proxy/
workflows/     # $ context DSL (on.ts, proxy.ts, schedule-builder.ts)
compat/        # API-compatible SDKs (15 implemented)
agents/        # Multi-provider agent SDK (Tool, Agent, Providers)
workers/       # DO proxy workers (api.ts, hostname-proxy.ts)
app/           # TanStack Start frontend (MDXUI components)
```

## DO Proxy Workers

Route requests to Durable Objects with the clean `API()` factory:

```typescript
import { API } from 'dotdo'

// Hostname mode (default) - subdomain → DO namespace
// tenant.api.dotdo.dev → DO('tenant')
export default API()

// Path param routing (Express-style)
// api.dotdo.dev/acme/users → DO('acme')
export default API({ ns: '/:org' })

// Nested path params
// api.dotdo.dev/acme/proj1/tasks → DO('acme:proj1')
export default API({ ns: '/:org/:project' })

// Fixed namespace (singleton DO)
export default API({ ns: 'main' })
```

The `API()` factory auto-detects DO bindings and forwards requests with the namespace stripped from the path.

## Key APIs

```typescript
// Three durability levels
$.send(event)              // Fire-and-forget
$.try(action)              // Single attempt
$.do(action)               // Durable with retries

// Event handlers (infinite Noun.verb combinations)
$.on.Customer.signup(handler)
$.on.Payment.failed(handler)

// Scheduling
$.every.monday.at('9am')(handler)
$.every.hour(handler)

// Cross-DO RPC
await $.Customer(id).notify()
```

## Named Agents

Implemented in `agents/named/` with composable persona system:

| Agent | Role |
|-------|------|
| Priya | Product—specs, roadmaps |
| Ralph | Engineering—builds code |
| Tom | Tech Lead—architecture, review |
| Mark | Marketing—content, launches |
| Sally | Sales—outreach, closing |
| Quinn | QA—testing, quality |

## Human Escalation

Template literal syntax implemented in `lib/humans/`:

```typescript
import { legal, ceo } from 'humans.do'

const approved = await ceo`approve the partnership`

escalation = this.HumanFunction({
  trigger: 'refund > $10000',
  role: 'senior-accountant',
  sla: '4 hours',
})
```

Human notification channels and escalation policies implemented in `objects/Human.ts`.

## Issue Tracking (bd)

```bash
bd ready                              # Find work
bd update <id> --status in_progress   # Claim
bd close <id>                         # Complete
bd sync                               # Sync with git
```

## Related

- [MDXUI](https://mdxui.dev) — UI components (Beacon for sites, Cockpit for apps)
- [org.ai](https://id.org.ai) — Identity for AI + humans
- [platform.do](https://platform.do) · [agents.do](https://agents.do) · [workers.do](https://workers.do)
