# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is dotdo?

dotdo is a framework for building AI-native applications on Cloudflare Workers with Durable Objects and SQLite. It provides:

- A base DO class with built-in Drizzle ORM, workflow context, and lifecycle operations
- Hono-based API routes with multiple transports (REST, MCP, RPC)
- Better Auth integration for authentication
- A type system based on Things, Nouns, and Verbs

## Commands

```bash
# Development
npm run dev              # Start Wrangler dev server (API)
npm run dev:app          # Start app dev server (cd app && npm run dev)

# Testing
npm test                 # Run vitest in watch mode
npm run test:run         # Run tests once
npm run test:ui          # Run tests with UI

# Build & Deploy
npm run build            # Build the app (cd app && npm run build)
npm run deploy           # Build and deploy via Wrangler
npm run typecheck        # TypeScript type checking
```

### Test Workspaces

Tests are split into two workspaces in `vitest.workspace.ts`:

- **node**: File system / config verification tests (`api/tests/setup.test.ts`, `api/tests/static-assets.test.ts`)
- **workers**: Cloudflare Workers pool tests (`api/tests/infrastructure/`, `api/tests/routes/`, `api/tests/middleware/`)

Run a specific test file:

```bash
npx vitest run api/tests/routes/api.test.ts
```

## Architecture

### Core Layers

```
api/              # Hono HTTP API (entrypoint: api/index.ts → wrangler.toml main)
├── routes/       # Route handlers (api, mcp, rpc)
├── middleware/   # Hono middleware (error-handling, auth)
└── tests/        # Vitest tests organized by type

objects/          # Durable Object class hierarchy
├── DO.ts         # Base class - identity, storage (Drizzle+SQLite), workflow context ($)
├── Worker.ts     # Worker base (Agent, Human extend this)
├── Entity.ts     # Entity base (Collection, Directory, Package, Product extend this)
├── Workflow.ts   # Multi-step workflow orchestration
└── ...           # Business, App, Site, SaaS, Service, API, SDK, CLI

types/            # TypeScript types
├── Thing.ts      # Core data unit with versioning
├── Noun.ts       # Schema definitions (field types, validation)
├── Verb.ts       # Action definitions
└── WorkflowContext.ts  # The $ proxy API

db/               # Drizzle schema definitions (SQLite)
├── things.ts     # Core things table
├── actions.ts    # Append-only action log
├── events.ts     # Event stream
├── auth.ts       # Better Auth tables (users, sessions, orgs, etc.)
└── ...

workflows/        # Workflow DSL implementation
├── on.ts         # Event handlers ($.on.Noun.verb)
├── proxy.ts      # Domain proxy ($.Noun(id))
├── hash.ts       # Content-addressable storage
└── pipeline-promise.ts  # Promise-based pipelines
```

### The $ Workflow Context

The `$` object on every DO provides the workflow API:

```typescript
// Execution modes
$.send(event, data) // Fire-and-forget (non-blocking, non-durable)
$.try(action, data) // Quick attempt (blocking, non-durable)
$.do(action, data) // Durable execution with retries (blocking, durable)

// Event handlers
$.on.Customer.created(handler)
$.on.Payment.failed(handler)

// Scheduling
$.every.monday.at('9am')(handler)

// Domain resolution
$.Customer(id).notify() // Resolves and calls method on DO
```

### DO Class Hierarchy

```
DO (Base)
├── Worker → Agent, Human
├── Entity → Collection, Directory, Package, Product
├── Business, App, Site, SaaS
├── Workflow
├── Function
├── Service
└── API, SDK, CLI
```

### Entry Points (Tree-Shakable)

```typescript
import { DO } from 'dotdo' // Full featured
import { DO } from 'dotdo/tiny' // Minimal, no deps
import { DO } from 'dotdo/rpc' // Deps via RPC bindings
import { DO } from 'dotdo/auth' // With Better Auth
```

## Wrangler Configuration

Key bindings in `wrangler.toml`:

- `KV` - KV namespace for sessions/caching
- `DO` - Main Durable Object namespace
- `ASSETS` - Static asset serving with SPA fallback
- Routes `/api/*`, `/mcp`, `/rpc/*` are handled by the worker

## Issue Tracking

This project uses **bd** (beads) for issue tracking. See `AGENTS.md` for workflow details.

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```
