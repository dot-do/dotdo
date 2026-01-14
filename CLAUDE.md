# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## IMPORTANT: dotdo vs workers.do

**This is dotdo** - the **runtime/framework layer**. Think of it like Node.js.

| | **dotdo (this repo)** | **workers.do (separate repo)** |
|---|---|---|
| **Role** | Runtime/Framework | Platform/Product |
| **Analogy** | Node.js | Heroku |
| **Users** | Infrastructure developers | Startup founders, teams |
| **Package** | `dotdo` | `agents.do`, `teams.do`, `workers.do` |

### What belongs HERE (dotdo)

- DO class with SQLite storage (Things, Relationships, Events, Actions)
- Minimal Hono passthrough worker
- Cap'n Web RPC and transport layers
- WorkflowContext ($) and event system
- Extended primitives in `do/capabilities/` (fsx, gitx, bashx, npmx, pyx)
- AI module (`ai/`) with template literals and LLM routing

### What belongs ELSEWHERE

- **workers.do repo**: Named agents (Priya, Ralph, Tom), Teams, Business-as-Code
- **compat repo**: 90+ API-compatible SDKs (redis, postgres, stripe, etc.)

## Directory Structure (19 directories)

```
api/           # Minimal Hono worker - passthrough to DO
  agents/      # Agent SDK (providers, tools, memory)
objects/       # Durable Object classes - the core runtime
  DO.ts        # Main DO class with SQLite storage
  DOBase.ts    # Base class with REST router, persistence
types/         # Thing, Noun, Verb, WorkflowContext
db/            # Database layer
  streams/     # SQL schemas (things.sql, events.sql, etc.)
  primitives/  # Storage innovations (columnar, time-series, etc.)
do/            # DO-specific code
  primitives/  # DO primitives (temporal-store, window-manager, etc.)
  capabilities/ # Submodules: fsx, gitx, bashx, npmx, pyx
ai/            # AI module
  llm/         # Multi-provider LLM routing
  evals/       # LLM evaluations
  primitives/  # AI primitives submodule (primitives.org.ai)
workflows/     # $ context DSL (on.ts, schedule-builder, pipeline-promise)
streaming/     # Event streaming infrastructure
workers/       # DO proxy workers, observability
  public/      # Static asset configs
app/           # TanStack Start frontend
lib/           # Shared utilities (consolidated from roles, services, etc.)
auth/          # better-auth configuration
cli/           # CLI commands
packages/      # Published @dotdo/* packages (client, react, rpc, etc.)
docs/          # Documentation
examples/      # Example code, templates, deploy configs
tests/         # Test files and benchmarks
scripts/       # Build scripts
```

## Commands

```bash
npm run dev          # Wrangler dev server
npm test             # Vitest watch mode
npm run test:run     # Tests once
npm run typecheck    # TypeScript check
npm run deploy       # Build + deploy
```

### Running Tests

```bash
npx vitest run path/to/test.ts        # Single file
npx vitest --project=objects          # DO tests (real miniflare runtime)
npx vitest --project=workers          # Workers runtime
npx playwright test tests/e2e/        # E2E browser tests
```

### Testing Philosophy: NO MOCKS

**Durable Objects require NO MOCKING.** Miniflare runs real DOs with real SQLite locally.

```typescript
import { env } from 'cloudflare:test'

// Get real DO instance
const stub = env.DO.get(env.DO.idFromName('test'))

// Test via RPC (preferred)
const result = await stub.things.create({ $type: 'Customer', name: 'Alice' })
expect(result.$id).toBeDefined()

// Test via fetch
const res = await stub.fetch('https://test.api.dotdo.dev/customers')
expect(res.status).toBe(200)
```

**Never mock stores or DO state** - use real miniflare instances.

## Worker Architecture

The worker is a minimal passthrough to the DO:

```typescript
// api/index.ts - entire worker
export { DO } from '../objects/DO'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    const id = env.DO.idFromName(ns)
    const stub = env.DO.get(id)

    return stub.fetch(request)
  }
}
```

Namespace derived from hostname: `tenant.api.dotdo.dev` → `DO('tenant')`

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

// Cross-DO RPC
await $.Customer(id).notify()
```

## Issue Tracking (bd) with Hierarchical IDs

Beads uses hierarchical IDs for epic → task → subtask structure:

```
do-ifi           [P0] [epic]  - dotdo Core Runtime
├── do-ifi.1     [P1] [task]  - DO Storage Layer
│   ├── do-ifi.1.1            - Things store
│   ├── do-ifi.1.2            - Relationships store
│   └── do-ifi.1.3            - Events store
├── do-ifi.2     [P1] [task]  - Hono Worker Passthrough
└── do-ifi.3     [P1] [task]  - Cap'n Web RPC
```

### Creating Hierarchical Issues

```bash
# Create epic
bd create --type=epic --title="Feature X" --priority=0

# Create task under epic (auto-generates do-xxx.1)
bd create --type=task --parent=do-xxx --title="Subtask"

# Create subtask (auto-generates do-xxx.1.1)
bd create --type=task --parent=do-xxx.1 --title="Sub-subtask"
```

### Common Commands

```bash
bd ready                              # Find work (no blockers)
bd list --status=open                 # All open issues
bd show <id>                          # Issue details with hierarchy
bd update <id> --status=in_progress   # Claim work
bd close <id>                         # Complete
bd sync                               # Sync with git
```

### Session Close Protocol

**NEVER end a session without:**

```bash
bd sync              # Sync issues
git status           # Check for changes
git add -A && git commit -m "..."
git push
```

## Process Management

**Vitest/Vite consume memory.** Guidelines:

1. Never run multiple vitest instances in parallel
2. Use `npx vitest run` (not watch mode) for CI
3. Kill orphans: `pkill -9 -f vitest; pkill -9 -f vite`

**For subagents:** Run ONE test file at a time.

## Unified Storage Architecture

The `objects/unified-storage/` module implements a cost-optimized storage pattern using Pipeline-as-WAL (Write-Ahead Log).

### Architecture Overview

```
Write Path:
  Client → PipelineEmitter → Pipeline (WAL) → ACK
                ↓
         InMemoryState
                ↓
         LazyCheckpointer → SQLite (batched)

Read Path:
  Client → InMemoryState (O(1)) → Response
```

### Key Components

| Component | Role | Performance |
|-----------|------|-------------|
| **InMemoryStateManager** | Fast reads/writes, dirty tracking | O(1) CRUD |
| **PipelineEmitter** | Fire-and-forget event emission | Immediate durability |
| **LazyCheckpointer** | Batched SQLite persistence | 95% cost reduction |
| **ColdStartRecovery** | State restoration on startup | SQLite → Iceberg fallback |
| **UnifiedStoreDO** | Main DO integrating all components | Full integration |

### Key Invariant

**Pipeline is the WAL.** Events are durable in Pipeline BEFORE local SQLite persistence. This guarantees:
- Zero data loss on DO eviction
- Immediate ACK to clients
- Lazy/batched local persistence for cost optimization

### Cost Model

Traditional approach: 1 SQLite write per operation = $$$

Unified Storage approach:
- Immediate: Emit to Pipeline (cheap, batched by Cloudflare)
- Deferred: Batch checkpoint to SQLite every N seconds or N dirty entries
- Result: **~95% reduction in SQLite write operations**

### Usage

```typescript
// In a Durable Object
const store = new UnifiedStoreDO(state, env, {
  namespace: 'tenant-123',
  checkpointInterval: 5000,    // Checkpoint every 5s
  dirtyCountThreshold: 100,    // Or when 100+ dirty entries
})

// Cold start recovery
await store.onStart()

// WebSocket operations (Pipeline-first, ACK before SQLite)
store.handleCreate(ws, { type: 'create', $type: 'Customer', data: { name: 'Alice' } })
```

See `objects/unified-storage/README.md` for detailed documentation.

## Related

- [MDXUI](https://mdxui.dev) — UI components
- [workers.do](https://workers.do) — Platform/Product layer
- [compat repo](https://github.com/dot-do/compat) — API-compatible SDKs
