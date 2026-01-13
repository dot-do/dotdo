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

**Cap'n Web RPC:** Promise pipelining integration with `capnweb`. One network round trip for entire pipelines—unawaited promises pass directly to servers.

**Extended Primitives:** fsx (filesystem on SQLite), gitx (Git on R2), bashx (shell without VMs), npmx, pyx - implemented as separate packages in `primitives/`.

**Compat SDKs (40+ layers):** Drop-in API replacements backed by Durable Objects. Located in `compat/` (algolia, anthropic, discord, duckdb, github, kafka, linear, mongo, openai, postgres, pusher, redis, s3, sendgrid, sentry, shopify, slack, sqs, stripe, supabase, twilio, zendesk, etc.).

## Commands

```bash
npm run dev          # Wrangler dev server
npm run dev:app      # App dev server (TanStack Start)
npm test             # Vitest watch mode
npm run test:run     # Tests once (--reporter=dot)
npm run typecheck    # TypeScript check
npm run deploy       # Build + deploy
npm run lint         # ESLint
```

### Running Tests

```bash
npx vitest run path/to/test.ts        # Single file
npx vitest --project=workers          # Workers runtime (miniflare)
npx vitest --project=compat           # Compat layer tests
npx vitest --project=agents           # Agent SDK tests
npx vitest --project=objects          # DO tests (real miniflare runtime)
npx vitest --project=lib              # Library utility tests
npx vitest --project=workflows        # Workflow proxy tests
npx playwright test tests/e2e/        # E2E browser tests
```

See `vitest.workspace.ts` for all 80+ test workspaces organized by domain.

### Testing Philosophy: NO MOCKS

**Durable Objects require NO MOCKING.** Miniflare runs real DOs with real SQLite locally.

#### Why No Mocks?

- **Mocks hide real bugs** - We discovered schema wasn't being created because mocks bypassed real SQLite
- **Miniflare is the real runtime** - It provides actual DO instances with actual storage
- **Tests should verify real behavior** - Not mock behavior that may differ from production

#### How to Test DOs

```typescript
import { env } from 'cloudflare:test'

// Get real DO instance
const stub = env.DO.get(env.DO.idFromName('test'))

// Test via RPC (preferred - 95% of tests)
const result = await stub.things.create({ $type: 'Customer', name: 'Alice' })
expect(result.$id).toBeDefined()

// Test via fetch (for HTTP API behavior - 5% of tests)
const res = await stub.fetch('https://test.api.dotdo.dev/customers')
expect(res.status).toBe(200)
```

#### What NOT to Do

```typescript
// WRONG - Never mock stores or storage
const mockStore = createMockThingsStore() // DELETE THIS
vi.mock('../db/stores')                    // DELETE THIS
const ctx = { things: mockStore }          // DELETE THIS

// WRONG - Never mock DO state
const mockState = createMockState()        // DELETE THIS
```

#### Test Configuration

Use `@cloudflare/vitest-pool-workers` with real wrangler config:

```typescript
// vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' }
      }
    }
  }
})
```

### Process Management (IMPORTANT)

**Vitest and Vite can consume excessive memory.** Follow these guidelines:

1. **Never run multiple vitest/vite instances in parallel** - they spawn many child processes
2. **Always run tests sequentially**, not in parallel background shells
3. **Kill orphan processes** before starting new dev servers:
   ```bash
   pkill -9 -f vitest; pkill -9 -f vite
   ```
4. **Use `run` mode for CI/one-shot tests**, not watch mode:
   ```bash
   npx vitest run  # Good - runs once and exits
   npx vitest      # Caution - watch mode stays running
   ```
5. **Check for zombie processes** if memory gets high:
   ```bash
   ps aux | grep -E "(vitest|vite|node)" | grep -v grep
   ```

**For subagents:** Run ONE test file at a time. Never launch parallel vitest processes.

## Architecture

```
api/           # Hono HTTP (routes/, middleware/, generators/)
objects/       # DO classes - the core runtime
  DOBase.ts    # Base class with REST router, SQLite, persistence (104K LOC)
  Entity.ts    # Domain objects with CRUD
  Startup.ts   # Business container
  Agent.ts     # AI workers with tools
  Human.ts     # Approval workflows
  Workflow*.ts # Workflow runtime, factory, state machines
types/         # Thing, Noun, Verb, WorkflowContext
db/            # Drizzle schemas, iceberg/, edgevec/, parquet/, proxy/
workflows/     # $ context DSL
  on.ts        # Event handlers via two-level proxy
  schedule-builder.ts  # CRON via fluent DSL
  pipeline-promise.ts  # Promise pipelining
  context/     # Execution modes
compat/        # API-compatible SDKs (40+ packages)
agents/        # Multi-provider agent SDK
  Agent.ts     # Core agent class
  Tool.ts      # Tool definitions
  providers/   # OpenAI, Anthropic, etc.
  named/       # Priya, Ralph, Tom, etc.
primitives/    # Edge-native implementations
  fsx/         # Filesystem on SQLite
  gitx/        # Git on R2
  bashx/       # Shell without VMs
  npmx/        # Package management
  pyx/         # Python execution
workers/       # DO proxy workers, observability tail
app/           # TanStack Start frontend (MDXUI components)
packages/      # Published @dotdo/* packages
lib/           # Shared utilities (sqids, rpc, channels, humans, etc.)
auth/          # better-auth configuration
cli/           # CLI commands (device auth, config)
```

## DO Proxy Workers

Route requests to Durable Objects with the `API()` factory:

```typescript
import { API } from 'dotdo'

// Hostname mode (default) - subdomain → DO namespace
export default API()  // tenant.api.dotdo.dev → DO('tenant')

// Path param routing (Express-style)
export default API({ ns: '/:org' })  // api.dotdo.dev/acme/users → DO('acme')

// Nested path params
export default API({ ns: '/:org/:project' })  // → DO('acme:proj1')

// Fixed namespace (singleton DO)
export default API({ ns: 'main' })
```

## Key APIs

```typescript
// Three durability levels
$.send(event)              // Fire-and-forget
$.try(action)              // Single attempt
$.do(action)               // Durable with retries

// Event handlers (infinite Noun.verb combinations via Proxy)
$.on.Customer.signup(handler)
$.on.Payment.failed(handler)
$.on.*.created(handler)    // Wildcards

// Scheduling (fluent DSL → CRON)
$.every.Monday.at9am(handler)
$.every.day.at('6pm')(handler)
$.every.hour(handler)

// Cross-DO RPC with circuit breakers
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

Template literal syntax in `lib/humans/`:

```typescript
import { legal, ceo } from 'humans.do'

const approved = await ceo`approve the partnership`

escalation = this.HumanFunction({
  trigger: 'refund > $10000',
  role: 'senior-accountant',
  sla: '4 hours',
})
```

Human notification channels (Slack, Discord, Email, MDXUI Chat) in `objects/Human.ts`.

## Issue Tracking (bd)

```bash
bd ready                              # Find work
bd update <id> --status in_progress   # Claim
bd close <id>                         # Complete
bd sync                               # Sync with git
```

### CRITICAL: Session Close Protocol

**NEVER end a session without completing this checklist:**

```bash
# 1. Verify bd sync succeeded (MUST show "Sync complete")
bd sync

# 2. Verify JSONL was actually updated
git status .beads/issues.jsonl
# If modified, the sync worked. If clean but you made changes, SYNC FAILED.

# 3. Check issue count matches expectations
wc -l .beads/issues.jsonl

# 4. Commit and push everything
git add .beads/issues.jsonl
git commit -m "bd sync: <description>"
git push

# 5. Verify push succeeded
git status
```

**WARNING SIGNS that sync failed:**
- `bd sync` shows "refusing to export" or validation errors
- `git status .beads/issues.jsonl` shows no changes after creating issues
- Issue count in JSONL doesn't match `bd stats` total

**If sync fails:**
1. Run `bd export --force` to force export
2. If that fails, manually backup the SQLite: `cp .beads/beads.db .beads/beads.db.backup`
3. Report the error - do NOT end session with unsynced data

**Data lives in TWO places:**
- `.beads/beads.db` (SQLite) - local working copy, NOT versioned
- `.beads/issues.jsonl` (JSONL) - git-tracked, THIS is the source of truth

If JSONL isn't updated and pushed, **all issue tracking work is lost** when the SQLite resets.

## Related

- [MDXUI](https://mdxui.dev) — UI components (Beacon for sites, Cockpit for apps)
- [org.ai](https://id.org.ai) — Identity for AI + humans
- [platform.do](https://platform.do) · [agents.do](https://agents.do) · [workers.do](https://workers.do)
