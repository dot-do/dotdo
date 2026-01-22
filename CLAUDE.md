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
- AI module with template literals and LLM routing
- Core database layer with abstract storage primitives

### What belongs ELSEWHERE

- **workers.do repo**: Named agents (Priya, Ralph, Tom), Teams, Business-as-Code
- **primitives repo**: AI primitives (ai-functions, ai-database, ai-workflows, etc.)
- **compat repo**: 90+ API-compatible SDKs (redis, postgres, stripe, etc.)

## Architecture (v3 Rewrite)

This is a **fresh v3 rewrite** using a monorepo architecture. Reference implementations are available in `.worktrees/v1` and `.worktrees/v2`.

### Workspace Packages

```
dotdo/              # Main package - re-exports all modules
├── api/            # @dotdo/api - Hono worker with HATEOAS
├── do/             # @dotdo/do - THE Durable Object class
├── db/             # @dotdo/db - Abstract storage layer
├── rpc/            # @dotdo/rpc - Cap'n Web RPC
├── ai/             # @dotdo/ai - AI routing with template literals
├── auth/           # @dotdo/auth - JWT auth with jose
├── mcp/            # @dotdo/mcp - Model Context Protocol tools
├── app/            # @dotdo/app - TanStack Start frontend
└── primitives/     # Git submodule → primitives.org.ai
```

### Package Purposes

| Package | Description | Dependencies |
|---------|-------------|--------------|
| **dotdo** | Main package with CLI, re-exports all modules | All workspace packages |
| **@dotdo/do** | THE Durable Object for Digital Objects. DO = Durable Object = Digital Object | @dotdo/db, @dotdo/rpc |
| **@dotdo/api** | Self-describing Hono API with HATEOAS, auto-generates SDK/CLI/MCP | @dotdo/auth, @dotdo/do |
| **@dotdo/db** | Abstract storage layer (Things, Relationships, Events) | None |
| **@dotdo/rpc** | Cap'n Web RPC for all communication layers | capnweb |
| **@dotdo/ai** | AI routing layer with template literals, multi-provider support | None |
| **@dotdo/auth** | JWT-based authentication using jose | jose |
| **@dotdo/mcp** | Model Context Protocol tools for AI agents | @dotdo/do |
| **@dotdo/app** | TanStack Start frontend with React 19 | @tanstack/start |

### Built-in Entities (@dotdo/do)

The DO class provides built-in entities and relationships:

- **Nouns, Verbs, Things, Actions, Relationships**
- **Events, Functions, Workflows**
- **Integrations, Connections**
- **Orgs, Users, API Keys**
- **Analytics**

### WorkflowContext ($)

The `$` context provides a fluent API for events, scheduling, and cross-DO RPC:

```typescript
// Event handlers (infinite Noun.verb combinations via Proxy)
$.on.Customer.signup(async (event) => {
  await $.send({ type: 'welcome-email', to: event.email })
})

// Durability levels
$.send(event)              // Fire-and-forget
$.try(action)              // Single attempt
$.do(action)               // Durable with retries

// Scheduling (fluent DSL → CRON)
$.every.Monday.at('9am')(async () => {
  await generateWeeklyReport()
})

$.every.day.at('6pm')(handler)
$.every.hour(handler)

// Cross-DO RPC
await $.Order('order-123').ship()
await $.Customer(id).notify()
```

## Commands

```bash
# Development
npm run dev          # Turbo dev (all packages)
npm test             # Vitest watch mode
npm run test:run     # Tests once
npm run typecheck    # TypeScript check across all packages
npm run build        # Build all packages
npm run deploy       # Build + deploy

# Package-specific
cd api && npm run dev       # Run API worker
cd do && npm test           # Test DO package
cd app && npm run dev       # Run TanStack Start app
```

### Running Tests

```bash
# Run all tests
npm test
npm run test:run            # Run once, no watch

# Run specific package tests
npm test --workspace=@dotdo/do
npm test --workspace=@dotdo/api

# Run single test file
npx vitest run do/tests/DO.test.ts
npx vitest run api/tests/hateoas.test.ts

# Run with specific runtime
npx vitest --project=objects      # DO tests (real miniflare runtime)
npx vitest --project=workers      # Workers runtime
```

## Testing Philosophy: NO MOCKS

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

**Never mock stores or DO state** - use real miniflare instances with real SQLite.

### Example Test Pattern

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { DO } from '../DO'

describe('DO Feature', () => {
  let doInstance: DO
  let mockState: DurableObjectState

  beforeEach(() => {
    // Use real DurableObjectState, not mocks
    mockState = createMockState() // Creates real Map-backed storage
    doInstance = new DO(mockState, {})
  })

  it('should handle requests', async () => {
    const request = new Request('https://do/')
    const response = await doInstance.fetch(request)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.status).toBe('ok')
  })
})
```

## Worker Architecture

The worker is a **minimal passthrough** to the DO:

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

**Namespace derivation**: `tenant.api.dotdo.dev` → `DO('tenant')`

All business logic lives in the DO, not the worker. The worker is just a router.

## Issue Tracking (bd) with Hierarchical IDs

Beads uses **hierarchical IDs** for epic → task → subtask structure:

```
do-7rf           [P0] [epic]  - dotdo v3 Architecture
├── do-7rf.1     [P1] [task]  - @dotdo/rpc - Cap'n Web RPC
│   ├── do-7rf.1.1            - Client implementation
│   ├── do-7rf.1.2            - Server implementation
│   └── do-7rf.1.3            - Transport layers
├── do-7rf.2     [P1] [task]  - @dotdo/db - Storage Layer
├── do-7rf.3     [P1] [task]  - @dotdo/do - Durable Object
└── do-7rf.4     [P1] [task]  - @dotdo/api - Hono API
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
bd close <id1> <id2> ...              # Close multiple at once
bd sync                               # Sync with git
```

### Subagent Workflow

The hierarchical structure simplifies subagent management:

1. **Main agent** creates epic and decomposes into tasks
2. **Subagents** claim individual tasks via `bd update <id> --status=in_progress`
3. **Subagents** close tasks when complete via `bd close <id>`
4. **Main agent** monitors progress and closes epic when all tasks done

## Session Close Protocol

**NEVER end a session without:**

```bash
bd sync              # Sync issues
git status           # Check for changes
git add -A && git commit -m "..."
git push             # PUSH TO REMOTE
```

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

Note: Current branch (v3) is an ephemeral worktree branch. Always check branch before pushing.

## Process Management

**Vitest/Vite consume memory.** Guidelines:

1. Never run multiple vitest instances in parallel
2. Use `npx vitest run` (not watch mode) for CI
3. Kill orphans: `pkill -9 -f vitest; pkill -9 -f vite`

**For subagents:** Run ONE test file at a time.

## Key Design Patterns

### 1. Everything is a DO

All state lives in Durable Objects. Workers are stateless routers.

### 2. RPC-First Communication

Cap'n Web RPC handles all communication: Client→Worker, Worker→DO, DO→DO.

### 3. HATEOAS API

The API is self-describing with clickable links. Define once → SDK, CLI, API, MCP all auto-generated.

### 4. $ Context DSL

The WorkflowContext provides a fluent API for events, scheduling, and cross-DO calls.

### 5. Template Literal AI

AI routing uses template literals: `` await ai`Summarize: ${text}` ``

### 6. Type-Safe Primitives

Full TypeScript support across all packages with strict type checking.

### 7. DO Sharding

For high-throughput scenarios, use sharding to distribute load across multiple DO instances. See [docs/SHARDING.md](./docs/SHARDING.md) for comprehensive patterns.

```typescript
import { ShardRouter, HealthAwareRouter } from '@dotdo/do'

// Basic sharding with consistent hashing
const router = new ShardRouter({
  defaultShardCount: 16,
  entityShards: { users: 32, orders: 64 }
})

// Route request to appropriate shard
const { doName } = router.route({
  namespace: 'acme',
  path: '/users/user-123',
  entityType: 'users',
  entityId: 'user-123',
})
// doName = 'acme:users:shard-7'

// Health-aware routing (production)
const healthRouter = new HealthAwareRouter({
  defaultShardCount: 8,
  skipUnhealthyShards: true,
  preferHealthierShards: true,
})
```

**Available Routers:**
- `ShardRouter` - Basic consistent hashing
- `LoadBalancedRouter` - Load-aware routing (least-loaded, round-robin, weighted)
- `HealthAwareRouter` - Health-aware routing with automatic failover

## File Naming

Follow these naming conventions for consistency across the codebase:

| Element | Convention | Example |
|---------|------------|---------|
| **Files** | kebab-case | `stub-cache.ts`, `circuit-breaker.ts`, `rate-limit.ts` |
| **Durable Object files** | PascalCase (matches class) | `DO.ts`, `BusinessDO.ts`, `AuthDO.ts` |
| **Classes** | PascalCase | `StubCache`, `CircuitBreaker`, `RateLimiter` |
| **Functions/variables** | camelCase | `getStubCache()`, `circuitState`, `rateLimitConfig` |
| **Constants** | SCREAMING_SNAKE_CASE | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| **Type aliases/interfaces** | PascalCase | `StubCacheOptions`, `CircuitBreakerConfig` |

**Examples from this codebase:**

```typescript
// File: rpc/stub-cache.ts
export class StubCache {
  private readonly maxSize: number
  static readonly DEFAULT_MAX_SIZE = 1000
}

// File: do/BusinessDO.ts
export class BusinessDO extends DurableObject {
  // Durable Object class - file matches class name
}

// File: db/branded-types.ts
export type ThingId = string & { readonly __brand: 'ThingId' }
export function createThingId(value: string): ThingId { ... }
```

**Note:** Existing files that don't follow this convention should not be renamed to avoid breaking imports. Apply this standard to new files.

## Git Submodules

The `primitives/` directory is a **git submodule** pointing to [primitives.org.ai](https://primitives.org.ai).

### Initial Setup

After cloning the repo, initialize submodules:

```bash
npm run submodule:init
# or
./scripts/submodule-init.sh
# or manually
git submodule update --init --recursive
```

### Updating Submodules

To pull the latest changes from the submodule's remote:

```bash
npm run submodule:update
# or
./scripts/submodule-update.sh
# or manually
git submodule update --remote --merge
```

### Working with Submodules

**Key points:**

1. **Submodule is a separate repo** - Changes to `primitives/` must be committed in the primitives repo first
2. **dotdo tracks a commit** - The parent repo (dotdo) tracks a specific commit of the submodule
3. **Updating the reference** - After updating the submodule, commit the new reference:
   ```bash
   git add primitives
   git commit -m "chore: update primitives submodule"
   ```

**Making changes to primitives:**

```bash
cd primitives
git checkout main
git pull
# make changes
git add -A && git commit -m "your changes"
git push
cd ..
git add primitives
git commit -m "chore: update primitives submodule"
```

**Checking submodule status:**

```bash
git submodule status
```

## Related Repos

- **primitives** (submodule at `/primitives`) - [primitives.org.ai](https://primitives.org.ai) - AI primitives packages
- **workers.do** - Platform/Product layer with named agents and teams
- **compat** - 90+ API-compatible SDKs (redis, postgres, stripe, etc.)
