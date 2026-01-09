# ACID-Compliance / Jepsen-Inspired Test Suite Design

**Date:** 2026-01-09
**Status:** Draft
**Methodology:** TDD (Red → Green → Refactor)

## Overview

This document defines a comprehensive test suite for verifying consistency, durability, and correctness of dotdo's distributed Durable Object architecture, including:

- Cross-DO consistency (parent/child relationships)
- Replica/follower consistency
- Sharding operations
- E2E data pipeline (events → Pipelines → Streams → R2 Iceberg)

## Test Priorities

| Priority | Category | Rationale |
|----------|----------|-----------|
| LOW | Single-DO ACID | Cloudflare guarantees this |
| HIGH | Cross-DO consistency | Parent/child, promote/demote |
| HIGH | Replica consistency | Primary/follower sync |
| HIGH | Sharding operations | Shard/unshard correctness |
| HIGH | E2E pipeline | Events → R2 Iceberg |

---

## Directory Structure

```
db/tests/                          # Unit/Workers pool tests (vitest)
├── acid/                          # ACID property tests
│   ├── single-do.test.ts          # CF guarantees (smoke tests)
│   ├── cross-do.test.ts           # Parent/child consistency
│   └── concurrent-writes.test.ts  # Conflict detection
│
├── lifecycle/                     # DO lifecycle operations
│   ├── promote.test.ts            # Thing → DO
│   ├── demote.test.ts             # DO → Thing
│   ├── clone.test.ts              # Swiss-army-knife operation
│   ├── clone-modes.test.ts        # atomic/staged/eventual/resumable
│   ├── shard.test.ts              # Create shard set
│   └── unshard.test.ts            # Collapse shards
│
├── replication/                   # Replica/follower tests
│   ├── create-replica.test.ts     # clone({ asReplica: true })
│   ├── replica-lag.test.ts        # Consistency bounds
│   ├── read-your-writes.test.ts   # Session consistency
│   └── failover.test.ts           # Primary promotion
│
└── sharding/                      # Shard operations
    ├── shard-routing.test.ts      # Deterministic routing
    ├── cross-shard-query.test.ts  # Aggregation correctness
    └── rebalance.test.ts          # Shard migration

tests/db/                          # E2E tests (actual CF deployments)
├── pipeline/                      # Event pipeline tests
│   ├── events-to-pipeline.test.ts # DO → Pipeline emission
│   ├── pipeline-to-r2.test.ts     # Pipeline → R2 Iceberg
│   └── end-to-end.test.ts         # Full flow verification
│
├── clone-modes/                   # E2E clone mode tests
│   ├── atomic.e2e.test.ts         # Interruption → rollback
│   ├── staged.e2e.test.ts         # Two-phase commit
│   ├── eventual.e2e.test.ts       # Async reconciliation
│   └── resumable.e2e.test.ts      # Continuation after failure
│
└── failure-injection/             # Simulated failures
    ├── network-partition.test.ts  # Cross-DO communication failure
    ├── do-crash.test.ts           # Mid-operation crash
    └── pipeline-backpressure.test.ts # Sink unavailable
```

---

## Interface Definitions

### Location Types

```typescript
// types/Location.ts

// Cloudflare's internal names (we map FROM these)
type CFLocationHint = 'wnam' | 'enam' | 'sam' | 'weur' | 'eeur' | 'apac' | 'oc' | 'afr' | 'me'

// Friendly region names (our public API)
export type Region =
  | 'us-west'       // wnam
  | 'us-east'       // enam
  | 'south-america' // sam
  | 'eu-west'       // weur
  | 'eu-east'       // eeur
  | 'asia-pacific'  // apac
  | 'oceania'       // oc
  | 'africa'        // afr
  | 'middle-east'   // me

export const regionToCF: Record<Region, CFLocationHint> = {
  'us-west':       'wnam',
  'us-east':       'enam',
  'south-america': 'sam',
  'eu-west':       'weur',
  'eu-east':       'eeur',
  'asia-pacific':  'apac',
  'oceania':       'oc',
  'africa':        'afr',
  'middle-east':   'me',
}

// IATA codes (lowercase)
export type ColoCode =
  | 'iad' | 'ewr' | 'atl' | 'mia' | 'ord' | 'dfw' | 'den' | 'sjc' | 'lax' | 'sea'
  | 'lhr' | 'cdg' | 'ams' | 'fra' | 'mrs' | 'mxp' | 'prg' | 'arn' | 'vie'
  | 'sin' | 'hkg' | 'nrt' | 'kix'

// City names (PascalCase)
export type ColoCity =
  | 'Virginia' | 'Newark' | 'Atlanta' | 'Miami' | 'Chicago'
  | 'Dallas' | 'Denver' | 'SanJose' | 'LosAngeles' | 'Seattle'
  | 'London' | 'Paris' | 'Amsterdam' | 'Frankfurt' | 'Marseille'
  | 'Milan' | 'Prague' | 'Stockholm' | 'Vienna'
  | 'Singapore' | 'HongKong' | 'Tokyo' | 'Osaka'

// Accept either format
export type Colo = ColoCode | ColoCity

export const cityToCode: Record<ColoCity, ColoCode> = {
  Virginia: 'iad', Newark: 'ewr', Atlanta: 'atl', Miami: 'mia', Chicago: 'ord',
  Dallas: 'dfw', Denver: 'den', SanJose: 'sjc', LosAngeles: 'lax', Seattle: 'sea',
  London: 'lhr', Paris: 'cdg', Amsterdam: 'ams', Frankfurt: 'fra', Marseille: 'mrs',
  Milan: 'mxp', Prague: 'prg', Stockholm: 'arn', Vienna: 'vie',
  Singapore: 'sin', HongKong: 'hkg', Tokyo: 'nrt', Osaka: 'kix',
}

export const coloRegion: Record<ColoCode, Region> = {
  iad: 'us-east', ewr: 'us-east', atl: 'us-east', mia: 'us-east', ord: 'us-east',
  dfw: 'us-west', den: 'us-west', sjc: 'us-west', lax: 'us-west', sea: 'us-west',
  lhr: 'eu-west', cdg: 'eu-west', ams: 'eu-west', fra: 'eu-west', mrs: 'eu-west', mxp: 'eu-west',
  prg: 'eu-east', arn: 'eu-east', vie: 'eu-east',
  sin: 'asia-pacific', hkg: 'asia-pacific', nrt: 'asia-pacific', kix: 'asia-pacific',
}

export function normalizeLocation(location: Colo | Region): {
  code: ColoCode | null
  region: Region
  cfHint: CFLocationHint
}
```

### Lifecycle Types

```typescript
// types/Lifecycle.ts

// Clone modes (consistency guarantees)
export type CloneMode =
  | 'atomic'      // All-or-nothing, rollback on any failure
  | 'staged'      // Two-phase: prepare → commit, explicit rollback
  | 'eventual'    // Best-effort, async reconciliation
  | 'resumable'   // Checkpoint-based, continue from interruption

export interface CloneOptions {
  colo?: Colo | Region             // Target location
  asReplica?: boolean              // Create as follower
  compress?: boolean               // Squash version history
  unshard?: boolean                // Remove from shard set
  branch?: string                  // Clone specific branch
  version?: number                 // Clone at specific version
  mode?: CloneMode                 // Default: 'atomic'
}

export interface CloneResult {
  ns: string
  doId: string
  mode: CloneMode
  staged?: { prepareId: string; committed: boolean }
  checkpoint?: { id: string; progress: number; resumable: boolean }
}

export interface ShardOptions {
  key: string
  count: number
  strategy?: 'hash' | 'range' | 'roundRobin' | 'custom'
  mode?: CloneMode
}

export interface ShardResult {
  shardKey: string
  shards: Array<{ ns: string; doId: string; shardIndex: number; thingCount: number }>
}

export interface CompactOptions {
  archive?: boolean
  branches?: string[]
  olderThan?: Date
  keepVersions?: number
}

export interface DOLifecycle {
  move(options: { to: Colo | Region }): RpcPromise<MoveResult>
  compact(options?: CompactOptions): RpcPromise<CompactResult>
  clone(options?: CloneOptions): RpcPromise<CloneResult>
  shard(options: ShardOptions): RpcPromise<ShardResult>
  unshard(options?: UnshardOptions): RpcPromise<CloneResult>
  promote(options: { $id: string; to?: Colo | Region; mode?: CloneMode }): RpcPromise<PromoteResult>
  demote(options: { to: string; type?: string; compress?: boolean; mode?: CloneMode }): RpcPromise<DemoteResult>
  resume(options: { clone: string } | { shard: string } | { unshard: string }): RpcPromise<CloneResult | ShardResult>
}
```

---

## TDD Phases

### Phase 0: Foundation
- Location types and mappings
- Lifecycle type definitions
- Test infrastructure (mocks, helpers)

### Phase 1: Core Lifecycle Operations
- `move()` - rename from moveTo(), new signature
- `compact()` - add options
- `clone()` - basic implementation
- `promote()` - Thing → DO
- `demote()` - DO → Thing

### Phase 2: Clone Modes
- atomic mode (all-or-nothing)
- staged mode (two-phase commit)
- eventual mode (async reconciliation)
- resumable mode (checkpoint-based)

### Phase 3: Sharding
- `shard()` - create shard set
- shard routing - deterministic routing
- cross-shard queries - scatter-gather
- `unshard()` - consolidate shards

### Phase 4: Replication
- create replica via clone
- replica consistency and lag bounds
- read-your-writes semantics
- failover and primary promotion

### Phase 5: E2E Pipeline
- events to pipeline emission
- pipeline to R2 Iceberg sink
- end-to-end data flow

### Phase 6: Failure Injection
- network partition handling
- DO crash recovery
- pipeline backpressure

---

## Dependency Graph

```
Phase 0: Foundation
    ↓
Phase 1: Core Lifecycle
    ↓
    ├── Phase 2: Clone Modes
    │       ↓
    │   Phase 4: Replication
    │
    └── Phase 3: Sharding

Phase 5: E2E Pipeline (parallel after Phase 1)
    ↓
Phase 6: Failure Injection (depends on all above)
```

---

## Test File Summary

| Directory | Files | Tests (est.) |
|-----------|-------|--------------|
| `db/tests/acid/` | 3 | ~15 |
| `db/tests/lifecycle/` | 6 | ~40 |
| `db/tests/replication/` | 4 | ~25 |
| `db/tests/sharding/` | 4 | ~25 |
| `tests/db/pipeline/` | 3 | ~20 |
| `tests/db/clone-modes/` | 4 | ~20 |
| `tests/db/failure-injection/` | 3 | ~20 |
| **Total** | **27** | **~165** |

---

## Open Questions

1. **Node failure simulation**: How to reliably simulate DO crashes in E2E tests?
   - Test-only endpoints that throw
   - Cloudflare's `ctx.abort()`
   - External chaos engineering tools

2. **Pipeline testing**: Need actual Cloudflare Pipeline binding in wrangler.toml

3. **Replica sync mechanism**: Event-based? Snapshot-based? Hybrid?

4. **Shard coordinator**: Should original DO become coordinator, or separate coordinator DO?
