# Events, Analytics & Materialized Views

> Brainstorming notes for the event streaming and analytics layer

## Overview

Every operation in a DO flows through a unified model:

```
Action (send/try/do) → Event → Pipelines → R2 SQL
```

This document captures the design decisions for actions, events, and how they materialize into globally-queryable views.

---

## Action Durability Spectrum

Every function invocation is an **Action**. Durability is a dial, not a binary.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DURABILITY SPECTRUM                                  │
│                                                                              │
│   $.send(event, data)    $.try(action, data)    $.do(action, data)          │
│   ─────────────────────  ────────────────────   ──────────────────          │
│   • Fire and forget      • Quick attempt        • Durable execution         │
│   • Non-blocking         • Blocking             • Blocking                  │
│   • Non-durable          • Non-durable          • Durable (retries)         │
│   • Best-effort event    • Emit on complete     • Guaranteed event          │
│                                                                              │
│   ◄──────────────────────────────────────────────────────────────────────►  │
│   FAST/CHEAP                                              DURABLE/EXPENSIVE │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Durability Ownership

- **Our actions table**: Captures `send`, `try`, `do`, and direct DO method calls
- **CF Workflows engine**: Handles step-level durability for workflow steps

We do NOT duplicate workflow step storage - CF Workflows owns that. But we DO emit events for workflow completions.

**TBD**: Consider bringing workflow step durability into our actions table for unified visibility (see issue dotdo-91a).

---

## Append-Only Version Model

**Things are versioned, not mutated. Actions reference versions by rowid. Time travel is free.**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRADITIONAL (mutate in place)                        │
│                                                                              │
│   Thing { id, data, createdAt, updatedAt, createdBy, updatedBy }            │
│   Problem: History is lost, audit requires separate logging                 │
└─────────────────────────────────────────────────────────────────────────────┘

                                    ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROPOSED (append-only versions)                      │
│                                                                              │
│   Things = version log (rowid IS the version)                               │
│   Actions = who did what, referencing before/after rowids                   │
│   Events = derived from actions                                             │
│                                                                              │
│   Time travel = SELECT * FROM things WHERE rowid = ?                        │
│   Current state = SELECT * FROM things WHERE id = ? ORDER BY rowid DESC     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### In-DO SQLite Schema (normalized, efficient)

```typescript
// Nouns - type registry
nouns = {
  rowid: integer,           // PK
  noun: string,             // 'Startup'
  plural: string?,
  schema: json?,
}

// Verbs - predicate registry
verbs = {
  rowid: integer,           // PK
  verb: string,             // 'create'
  activity: string?,        // 'creating'
  event: string?,           // 'created'
  reverse: string?,         // 'createdBy' (for <-, <~ operators)
  inverse: string?,         // 'delete' (opposite action)
}

// Things - version log (append-only)
things = {
  rowid: integer,           // Version ID
  type: integer,            // FK → nouns.rowid
  id: string,               // Local path: 'acme', 'headless.ly'
  name: string?,
  data: json?,
}

// Actions - the source of truth
actions = {
  rowid: integer,           // Sequence
  verb: integer,            // FK → verbs.rowid
  actor: string,            // Local path or external URL
  target: string,           // Local path
  input: integer?,          // FK → things.rowid (before state)
  output: integer?,         // FK → things.rowid (after state)
  options: json?,
  status: text,             // 'pending', 'running', 'completed', 'failed', 'undone', 'retrying'
  error: json?,
}

// Events - derived from actions (for streaming)
events = {
  rowid: integer,           // Sequence = rowid
  actionId: integer,        // FK → actions.rowid
  verb: integer,            // FK → verbs.rowid (past tense: 'created')
  source: string,           // Local path
  streamed: boolean,
  streamedAt: integer?,
}
```

---

## Event Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DURABLE OBJECT                                  │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐                 │
│  │   Action    │ ───▶ │   Thing     │ ───▶ │   Event     │                 │
│  │  (command)  │      │  (version)  │      │  (emitted)  │                 │
│  └─────────────┘      └─────────────┘      └─────────────┘                 │
│                                                   │                          │
└───────────────────────────────────────────────────┼──────────────────────────┘
                                                    │
                        ┌───────────────────────────┼───────────────────────────┐
                        │                           │                           │
                        ▼                           ▼                           ▼
          ┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
          │      PIPELINES       │    │      WORKFLOWS       │    │      OTHER DOs       │
          │  (direct write)      │    │  (direct call)       │    │  (RPC/CapnWeb)       │
          │                      │    │                      │    │                      │
          │  → Streams → R2      │    │  $.do('process', {}) │    │  $.Startup(id).notify│
          └──────────────────────┘    └──────────────────────┘    └──────────────────────┘
                        │
                        ▼
          ┌───────────────────────────────────────────┐
          │              R2 SQL                        │
          │  • Materialized views                      │
          │  • Cross-DO queries                        │
          │  • Audit log (SOC2)                        │
          └───────────────────────────────────────────┘
```

**Direct paths (low latency, no queue cost):**
- DO → Pipelines (every event, for materialization)
- DO → Workflows (initiate durable execution)
- DO → Other DOs (RPC calls via CapnWeb)

**Queues are for workflow-to-workflow feedback loops only** - not every event.

---

## Local vs Global Schema

**In-DO SQLite**: Normalized, rowid FKs, efficient
**R2 SQL**: Denormalized, fully-qualified URLs, globally queryable

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         IN-DO SQLITE (local)                                 │
│                                                                              │
│   things.type = rowid FK → nouns.rowid                                      │
│   things.id = local path (e.g., 'acme', 'headless.ly')                      │
│   actions.verb = rowid FK → verbs.rowid                                     │
│                                                                              │
│   Efficient: integer FKs, no string duplication                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Pipelines (prepend ns)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         R2 SQL (global)                                      │
│                                                                              │
│   things.type = 'https://startups.studio/Startup'                           │
│   things.id = 'https://startups.studio/headless.ly'                         │
│   actions.verb = 'created'                                                  │
│                                                                              │
│   Queryable: Cross-DO joins, no need to know which DO owns what            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Use Cases for R2 SQL

All four are supported, with different latency requirements:

| Use Case | Description | Acceptable Latency |
|----------|-------------|-------------------|
| **Cross-DO queries** | "All Startups that raised in Q4" | Seconds to minutes |
| **Analytics dashboards** | Real-time metrics, time-series | Minutes |
| **Global search/discovery** | Find any Thing by properties | Seconds |
| **Audit/SOC2** | Full event history, compliance | Async (must be complete) |

For low-latency requirements, see issue **dotdo-6io** (sharding, replication, replicated indexes).

---

## Version & Branch Addressing

### Versions (linear history)

```
https://startups.studio/acme           → current/HEAD
https://startups.studio/acme?v=1234    → rowid version
https://startups.studio/acme?v=2024-01-08T12:00:00Z → timestamp
```

### Branches (divergent history) - @ref syntax (git-like)

```
https://startups.studio/acme              → HEAD of main
https://startups.studio/acme@main         → explicit main branch
https://startups.studio/acme@experiment   → experiment branch
https://startups.studio/acme@v1234        → specific version (rowid)
https://startups.studio/acme@~1           → one version back (relative)
https://startups.studio/acme@2024-01-08   → version at timestamp
```

### Branches table

```typescript
branches = {
  rowid: integer,
  name: string,             // 'main', 'experiment'
  head: integer,            // FK → things.rowid (current version)
  base: integer?,           // FK → things.rowid (forked from)
  forkedFrom: string?,      // Branch name it was forked from
  createdAt: integer,
}
```

---

## DO Lifecycle Operations

```typescript
// Fork - new identity from current state
await $.Startup('headless.ly').fork({
  to: 'https://startups.studio/headless-v2'
})
// Result: New DO, new URL, fresh history

// Compact - squash history, same identity
await $.Startup('headless.ly').compact()
// Result: Same DO, same URL, history collapsed to current state

// Move - relocate to different colo, same identity
await $.Startup('headless.ly').moveTo('ORD')
// Result: Same URL, new DO instance at ORD, old one deleted
```

### moveTo implementation

```
1. Create new DO with locationHint at target colo
2. Compact + transfer current state (no history)
3. Update objects table: ns → new doId
4. Delete old DO

URL stays the same, physical location changes
```

### Extended operations (geo-distribution building blocks)

```typescript
await do.moveTo('ORD')                    // Relocate primary
await do.replicateTo('LHR')               // Create read replica
await do.shardBy('customerId')            // Split by key
```

---

## Generic Function Signature

All DO methods follow this signature:

```typescript
type DOFunction<
  Output,
  Input = unknown,
  Options extends Record<string, unknown> = Record<string, unknown>
> = (input: Input, options?: Options) => Promise<Output>
```

Every action has:
- **verb** - the action being performed
- **actor** - who did it (Code/Agent/Human)
- **target** - what was affected
- **input** - the input data (references things.rowid for before state)
- **output** - the result (references things.rowid for after state)
- **options** - additional parameters

---

## Open Questions

1. **Conflict resolution for branches**: When merging, how do we handle conflicts?
2. **Garbage collection**: When to actually delete old versions vs keeping forever?
3. **Cross-DO transactions**: How to coordinate atomic operations across multiple DOs?
4. **Event ordering guarantees**: What consistency guarantees do we provide for events?

---

## Related Issues

- **dotdo-6io**: Sharding, replication, and replicated indexes for low-latency
- **dotdo-91a**: TBD - Consider bringing workflow step durability into actions table
