# CLAUDE.md

## What is dotdo?

A batteries-included framework for vibe coders to do a Foundation Sprint and build an Experimentation Machine where the result is a Profitable Autonomous Business.

**Core insight:** Infrastructure-as-Code unlocked SaaS. Business-as-Code unlocks Services-as-Software and autonomous businesses run by AI agents.

## The Journey

1. **Foundation Sprint** - Define customer, problem, differentiation → Founding Hypothesis
2. **Experimentation Machine** - Test hypotheses, measure HUNCH metrics (Hair-on-fire, Usage, NPS, Churn, LTV/CAC)
3. **Autonomous Business** - AI agents operate, humans escalate for sensitive decisions

## Key Primitives

```
DO (Base) - Drizzle ORM, workflow context ($), lifecycle operations
├── Startup - Business container (extends to Product, Service, SaaS, Marketplace, Directory)
├── Worker - Agent (AI) and Human (escalation via HumanFunction)
├── App, Site, API - Surfaces
└── Workflow, Function - Execution
```

**The $ context:** `$.send()` (fire-and-forget), `$.try()` (quick), `$.do()` (durable). Events via `$.on.Noun.verb()`. Scheduling via `$.every.monday.at('9am')()`.

## Commands

```bash
npm run dev          # Wrangler dev server
npm run dev:app      # App dev server
npm test             # Vitest watch mode
npm run test:run     # Tests once
npm run typecheck    # TypeScript check
npm run deploy       # Build and deploy
```

## Architecture

```
api/           # Hono HTTP (routes/, middleware/)
objects/       # DO classes (DO.ts base, Worker.ts, Entity.ts, etc.)
types/         # Thing, Noun, Verb, WorkflowContext
db/            # Drizzle schemas (things, actions, events, auth)
workflows/     # DSL (on.ts, proxy.ts, schedule-builder.ts)
```

## Test Workspaces

- **node**: File system / config tests
- **workers**: Cloudflare Workers pool tests

```bash
npx vitest run api/tests/routes/api.test.ts
```

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

- **MDXUI** (`~/projects/ui/apps/mdxui.dev`) - UI abstractions for Sites (Beacon) and Apps (Cockpit)
- **StartupBuilder** (`~/projects/startupbuilder`) - 150K+ startup ideas from O*NET/NAICS/Zapier
- **SB** (`~/projects/sb`) - StartupBuilder, SalesBuilder, ServicesBuilder using db4ai
