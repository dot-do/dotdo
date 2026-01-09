# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is dotdo?

A batteries-included framework for vibe coders to do a Foundation Sprint and build an Experimentation Machine where the result is a Profitable Autonomous Business.

**Core insight:** Infrastructure-as-Code unlocked SaaS. Business-as-Code unlocks Services-as-Software and autonomous businesses run by AI agents.

## The Journey

1. **Foundation Sprint** - Define customer, problem, differentiation → Founding Hypothesis
2. **Experimentation Machine** - Test hypotheses, measure HUNCH metrics (Hair-on-fire, Usage, NPS, Churn, LTV/CAC)
3. **Autonomous Business** - AI agents operate, humans escalate for sensitive decisions

## Commands

```bash
npm run dev          # Wrangler dev server
npm run dev:app      # App dev server (cd app && npm run dev)
npm test             # Vitest watch mode
npm run test:run     # Tests once (dot reporter)
npm run test:workers # Workers pool tests only
npm run typecheck    # TypeScript check
npm run deploy       # Build and deploy
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
```

### Running Specific Tests

```bash
# Run a single test file
npx vitest run api/tests/routes/api.test.ts

# Run tests for a specific workspace
npx vitest --project=workers    # Cloudflare Workers runtime tests
npx vitest --project=schema     # Database schema tests
npx vitest --project=compat     # Compatibility layer tests
npx vitest --project=workflows  # Workflow proxy tests

# Run all workspaces
npx vitest --workspace
```

### Test Workspaces

The project uses vitest workspaces to organize tests by environment:

- **Node environment**: `node`, `schema`, `iceberg`, `objects`, `lib`, `workflows`, `types`, `app`, `compat`, `agents`
- **Workers environment**: `workers` (uses @cloudflare/vitest-pool-workers for runtime tests)
- **JSDOM environment**: `app-components` (React component tests)

## Architecture

```
api/           # Hono HTTP routes and middleware
objects/       # Durable Object classes
├── DO.ts      # Base DO class with SQLite, Drizzle, lifecycle hooks
├── Worker.ts  # Agent/Human worker base
├── Entity.ts  # Data entity base
├── Browser.ts # Headless Chromium DO
└── SandboxDO.ts # Code execution sandbox
types/         # TypeScript types (Thing, Noun, Verb, WorkflowContext, etc.)
db/            # Drizzle schemas (things, actions, events, auth, stores)
├── iceberg/   # Parquet table navigation
├── edgevec/   # Vector index persistence
└── proxy/     # Fluent query builder
workflows/     # DSL for events and scheduling
├── on.ts      # Event handler DSL ($.on.Noun.verb)
├── proxy.ts   # $ context proxy
└── context/   # Workflow context builders
lib/           # Utilities (sqids, mixins, executors, RPC, rate-limit)
compat/        # API-compatible SDKs (supabase, firebase, mongo, postgres, redis, kafka, etc.)
agents/        # Agents SDK (Tool, Agent, Providers)
ai/            # AI template literal API
app/           # TanStack Start frontend
```

## Key Primitives

```
DO (Base) - Drizzle ORM, workflow context ($), lifecycle operations
├── Startup - Business container (extends to Product, Service, SaaS, Marketplace, Directory)
├── Worker - Agent (AI) and Human (escalation via HumanFunction)
├── App, Site, API - Surfaces
└── Workflow, Function - Execution
```

**The $ context:** `$.send()` (fire-and-forget), `$.try()` (quick), `$.do()` (durable). Events via `$.on.Noun.verb()`. Scheduling via `$.every.monday.at('9am')()`.

## Extended Primitives

Core system primitives reimplemented for Durable Objects:

- **fsx** - Full filesystem on DO SQLite with tiered storage (hot/warm/cold)
- **gitx** - Complete Git implementation built on fsx with R2 object storage
- **bashx** - Shell execution without VMs, runs natively on Workers

## Compatibility Layer (@dotdo/compat)

API-compatible packages for popular platforms, edge-native and AI-ready:

- `@dotdo/supabase`, `@dotdo/firebase`, `@dotdo/mongo`
- `@dotdo/postgres`, `@dotdo/kafka`, `@dotdo/redis`
- `@dotdo/dynamodb`, `@dotdo/pinecone`, `@dotdo/qdrant`
- Built-in sharding, replication, tiered storage
- Scales to millions of parallel AI agents

## Issue Tracking

Uses **bd** (beads). Issues have TDD phases (RED/GREEN/REFACTOR).

```bash
bd ready                              # Find work
bd show <id>                          # View details
bd update <id> --status in_progress   # Claim work
bd close <id>                         # Complete
bd sync                               # Sync with git
```

## Key Concepts

- **HumanFunction** - Escalation to humans for sensitive decisions (large refunds, audit risk, edge cases)
- **Services-as-Software** - Professional services delivered by AI agents
- **HUNCH metrics** - Hair-on-fire, Usage, NPS, Churn, LTV/CAC for PMF measurement
- **Business-as-Code** - Define business in code, deploy it, AI agents run it

## Related Projects

- **[MDXUI](https://mdxui.dev)** - UI abstractions for Sites (Beacon) and Apps (Cockpit)
- **[org.ai](https://id.org.ai)** - Identity and auth for AI and humans
