# E2E & Performance Benchmark Suite Design

## Overview

Two test suites for validating DO operations on real Cloudflare infrastructure:

1. **E2E Test Suite** — Correctness tests for DO lifecycle operations
2. **Performance Benchmark Suite** — Latency/throughput measurements with historical tracking

## Goals

- **Proof for customers** — Reproducible benchmarks customers can run
- **Regression protection** — Catch performance degradation in CI
- **Marketing ammunition** — Verified numbers for landing pages

## Infrastructure

- **Target:** workers.do enterprise zone (Workers for Platforms + custom hostnames)
- **Namespacing:** Subdomain is the namespace (e.g., `fork.perf.do` → `DO('fork')`)
- **Datasets:** example.com.ai (small fixtures), standards.org.ai (NAICS, ONET, UNSPSC)
- **Output:** `.jsonl` files committed to git for historical tracking
- **Thresholds:** Advisory only initially, evolve to statistical p50/p95/p99 gates

## Architecture

```
benchmarks/
├── e2e/                          # Correctness tests
│   ├── lifecycle/                # move, fork, promote, demote, clone, compact
│   ├── sharding/                 # shard, unshard, routing, rebalance
│   └── replication/              # replicate, failover, consistency
│
├── perf/                         # Performance benchmarks
│   ├── operations/               # Latency per lifecycle operation
│   ├── network/                  # Baseline HTTP/WS colo-to-colo
│   ├── queries/                  # R2/Iceberg benchmarks
│   ├── sharding/                 # Shard routing performance
│   ├── replication/              # Replica targeting performance
│   ├── primitives/               # All DO data primitives
│   └── datasets/                 # Real-world dataset benchmarks
│
├── fixtures/                     # Test data
│   ├── example.com.ai/
│   └── standards.org.ai/         # NAICS, ONET, UNSPSC
│
├── results/                      # Historical .jsonl output
├── lib/                          # Runner, reporter, utilities
└── vitest.config.ts
```

## Test Domains (perf.do)

| Domain | Purpose |
|--------|---------|
| `move.perf.do` | Move operation tests |
| `fork.perf.do` | Fork operation tests |
| `promote.perf.do` | Promote/demote tests |
| `shard.perf.do` | Sharding tests |
| `clone.perf.do` | Clone (all modes) tests |
| `replicate.perf.do` | Replication tests |
| `stores.perf.do` | Core 7 stores benchmarks |
| `streaming.perf.do` | Kafka compat primitives |
| `workflow.perf.do` | Temporal compat primitives |
| `vector.perf.do` | Vector index benchmarks |
| `naics.perf.do` | NAICS dataset fixture |
| `onet.perf.do` | ONET dataset fixture |
| `unspsc.perf.do` | UNSPSC dataset fixture |
| `network.perf.do` | Colo-to-colo baseline |
| `latency.perf.do` | Geographic latency tests |

## Benchmark Result Schema

```typescript
interface BenchmarkResult {
  name: string
  timestamp: string
  target: string
  iterations: number

  latency: {
    p50: number
    p95: number
    p99: number
    min: number
    max: number
    mean: number
    stddev: number
  }

  // Context
  coldStart?: boolean
  datasetSize?: number
  shardCount?: number
  colo?: string
  coloServed?: string
}
```

## Performance Claims to Validate

| Claim | Expected | Source |
|-------|----------|--------|
| Cold start (V8 isolate) | 0-5ms | CLAUDE.md |
| Cold start (empty SQLite) | 0-10ms | why-dotdo.mdx |
| Cold start (10MB SQLite) | 30-50ms | why-dotdo.mdx |
| Global latency | 10-50ms | edge-computing.mdx |
| Iceberg point lookup (cached) | 50-100ms | storage docs |
| Iceberg point lookup (cold) | 100-150ms | storage docs |
| Cross-shard scatter-gather | 150-300ms | scalability.mdx |
| RPS per DO | 1000+ | scalability.mdx |
| Concurrent WebSockets | 32,768 | scalability.mdx |

## E2E Test Coverage

### Lifecycle Operations

| Operation | Test Cases |
|-----------|------------|
| `move()` | Basic move, cross-colo, state preservation, merge options |
| `fork()` | Fork to new namespace, branch isolation |
| `promote()` | Thing→DO, history preservation, event emission |
| `demote()` | DO→Thing, atomic vs staged modes |
| `shard()` | Hash/range/roundRobin strategies, key distribution |
| `unshard()` | Merge shards back, data integrity |
| `replicate()` | Async replication, consistency verification |
| `clone()` | All 4 modes: atomic, staged, eventual, resumable |
| `compact()` | Storage optimization, data preservation |

### Shard/Replica Targeting

| Pattern | Purpose |
|---------|---------|
| `?shard=N` | Explicit shard index |
| `?shardKey=X` | Hash-route by key |
| `?scatter=true` | Force scatter-gather |
| `?replica=primary` | Read from primary |
| `?replica=nearest` | Read from closest |
| `?replica={region}` | Read from specific region |

## Primitive Benchmarks

### Core 7 Stores

- ThingsStore: create, get, list, update, versions
- RelationshipsStore: create, from, to
- ActionsStore: log, list, complete
- EventsStore: emit, list, replay
- SearchStore: index, query
- ObjectsStore: register, resolve, shards
- DLQStore: add, replay

### Advanced Primitives

| Primitive | Operations |
|-----------|------------|
| Cache | get (hit/miss), set, invalidateCascade, CAS |
| ColumnarStore | batch insert, aggregates, bloom filter |
| TemporalStore | put, time-range query, snapshot |
| VectorIndex | insert, kNN search, filtered search |
| InvertedIndex | index, BM25, boolean, phrase |

### Streaming (Kafka compat)

| Primitive | Operations |
|-----------|------------|
| Windows | tumbling, sliding, session, trigger |
| Watermarks | advance, isLate, current |
| Transactions | begin, process, commit, checkpoint |
| State | keyed get/update, window aggregate, checkpoint |
| Router | hash route, range route, assignment |
| CDC | capture, transform, sink |

### Workflow (Temporal compat)

| Primitive | Operations |
|-----------|------------|
| Workflows | create DAG, start run, status |
| Activities | execute local/remote, heartbeat |
| Signals | send, wait |
| Timers | create, cancel |
| Retry | fixed backoff, exponential with jitter |
| Sensors | create, check condition |

## Network Baseline

| Metric | Description |
|--------|-------------|
| `worker-to-do` | Worker in colo → DO |
| `do-to-do-same` | DO → DO same colo |
| `do-to-do-cross` | DO → DO different colo |
| `do-worker-do` | DO → Worker → DO (proxy overhead) |
| `http` vs `websocket` | Protocol comparison |

## Commands

```bash
npm run benchmark              # All benchmarks
npm run benchmark:e2e          # E2E correctness only
npm run benchmark:perf         # Performance only
npm run benchmark:network      # Network baseline only
npm run benchmark:primitives   # Primitives only
```

## Output

Results appended to `benchmarks/results/YYYY-MM-DD-benchmarks.jsonl`:

```jsonl
{"name":"promote","timestamp":"2026-01-13T10:30:00Z","target":"promote.perf.do","iterations":100,"latency":{"p50":12,"p95":28,"p99":45,"min":8,"max":62,"mean":15.3,"stddev":8.2},"colo":"ORD"}
{"name":"promote-cold","timestamp":"2026-01-13T10:31:00Z","target":"promote-cold.perf.do","iterations":20,"latency":{"p50":35,"p95":48,"p99":52,"min":28,"max":55,"mean":36.1,"stddev":6.8},"coldStart":true}
```

## Future Enhancements

1. **Statistical thresholds** — p50/p95/p99 gates once baselines established
2. **Regression detection** — Compare against historical baseline
3. **PR-triggered subset** — Run critical benchmarks on PRs
4. **Scheduled runs** — Weekly full benchmark suite
5. **Dashboard** — Push metrics to Grafana/CF Analytics Engine
