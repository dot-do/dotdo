# dotdo Architecture Documentation

This directory contains architecture documentation for the dotdo platform - the Business-as-Code framework for autonomous businesses run by AI agents.

## Overview

dotdo is built on three foundational technologies:

1. **V8 Isolates + Durable Objects** - Virtual Chrome tabs with persistent state, running on edge (300+ cities, 0ms cold starts)
2. **Cap'n Web RPC** - Promise pipelining for single round-trip network operations
3. **Extended Primitives** - Edge-native implementations of filesystem, git, shell, and more

## Documentation Index

### Architecture Documents

| Document | Description |
|----------|-------------|
| [DOBase Decomposition](./architecture/dobase-decomposition.md) | Analysis of DOBase.ts (~104KB) decomposition strategy for tree-shaking and maintainability |

### Research Spikes

Research spikes investigate specific technical challenges and propose solutions. See [Spikes Index](./spikes/README.md) for the full list.

#### Durable Object Patterns

| Spike | Description |
|-------|-------------|
| [Cron Hibernation](./spikes/cron-hibernation.md) | Cron scheduling strategies using DO alarms with hibernation |
| [Exactly-Once Hibernation](./spikes/exactly-once-hibernation.md) | Maintaining exactly-once processing across DO hibernation cycles |
| [Long-Running Tasks](./spikes/long-running-tasks.md) | Coordination strategies for tasks exceeding 30s CPU time |

#### Distributed Query Processing

| Spike | Description |
|-------|-------------|
| [Cross-DO Join Latency](./spikes/cross-do-join-latency.md) | Latency budgets for cross-DO joins in federated queries |
| [Broadcast Join Strategy](./spikes/broadcast-join-strategy.md) | Broadcast joins without shuffle network in the DO model |
| [Distributed Checkpoint Coordination](./spikes/distributed-checkpoint-coordination.md) | Chandy-Lamport style checkpointing across multiple DOs |

#### State Management

| Spike | Description |
|-------|-------------|
| [Checkpoint Size Limits](./spikes/checkpoint-size-limits.md) | DO storage limits and checkpoint strategies |
| [State Recovery Latency](./spikes/state-recovery-latency.md) | State recovery strategies and latency analysis |

#### Multi-Tenancy and Isolation

| Spike | Description |
|-------|-------------|
| [Multi-Tenant Semantic Isolation](./spikes/multi-tenant-semantic-isolation.md) | Isolation patterns for multi-tenant semantic layers |
| [Rate Limiting Isolates](./spikes/rate-limiting-isolates.md) | Rate limiting strategies in V8 isolate environment |
| [OAuth Token Management](./spikes/oauth-token-management.md) | Token lifecycle management patterns |

#### Data Pipeline

| Spike | Description |
|-------|-------------|
| [Pipelines R2 Catalog](./spikes/pipelines-r2-catalog.md) | R2-based data catalog for pipelines |
| [Cross-DAG Dependency Triggers](./spikes/cross-dag-dependency-triggers.md) | Dependency management across DAG workflows |
| [WAL Parsing JS](./spikes/wal-parsing-js.md) | Write-ahead log parsing in JavaScript |

#### Query Engine

| Spike | Description |
|-------|-------------|
| [Cost Estimation Without Statistics](./spikes/cost-estimation-without-statistics.md) | Query cost estimation strategies |
| [Real-Time vs Cached Query Routing](./spikes/real-time-vs-cached-query-routing.md) | Query routing decision patterns |
| [Large Dataset Pagination](./spikes/large-dataset-pagination.md) | Pagination strategies for large datasets |
| [Memory Limits Intermediate Results](./spikes/memory-limits-intermediate-results.md) | Memory management for query processing |

#### Vector Search and Embeddings

| Spike | Description |
|-------|-------------|
| [Vector Search Infrastructure](./spikes/vector-search-infrastructure.md) | Vector search implementation patterns |
| [Embedding Model Selection](./spikes/embedding-model-selection.md) | Criteria for embedding model selection |
| [Similarity Threshold Calibration](./spikes/similarity-threshold-calibration.md) | Calibrating similarity thresholds |

#### Performance

| Spike | Description |
|-------|-------------|
| [Pre-Aggregation Storage](./spikes/pre-aggregation-storage.md) | Pre-computed aggregation strategies |
| [Cascade Parallelization DO Routing](./spikes/cascade-parallelization-do-routing.md) | Parallel execution patterns in DO routing |

### Design Plans

Design plans document planned implementations. Located in `docs/plans/`.

| Plan | Description |
|------|-------------|
| [Hono API Shape Design](./plans/2026-01-13-hono-api-shape-design.md) | Default API response shape for clickable URLs |
| [Fumadocs Static Prerender](./plans/2026-01-12-fumadocs-static-prerender-design.md) | Static site generation design |
| [Autonomous Agents OKRs](./plans/2026-01-13-autonomous-agents-okrs-design.md) | OKR tracking for AI agents |
| [DO Start CLI](./plans/2026-01-13-do-start-cli-design.md) | CLI for DO development |
| [E2E Perf Benchmark](./plans/2026-01-13-e2e-perf-benchmark-design.md) | End-to-end performance benchmarking |

### Type Safety

| Document | Description |
|----------|-------------|
| [as-unknown-as Audit](./type-safety/as-unknown-as-audit.md) | Audit of `as unknown as` patterns and remediation plan |

## Key Architecture Concepts

### DO Class Hierarchy

```
DurableObject (cloudflare:workers)
    |
    v
DOTiny (~15KB) - Identity, storage, fetch
    |
    v
DOBase (~104KB) - WorkflowContext, stores, events, scheduling
    |
    v
DOFull (~70KB) - Lifecycle (fork, clone, branch), sharding
```

See [DOBase Decomposition](./architecture/dobase-decomposition.md) for the module extraction strategy.

### Cross-DO Communication

Cross-DO calls have different latency profiles:
- Same-colo: ~2-5ms p50
- Cross-colo: ~50-150ms p50

See [Cross-DO Join Latency](./spikes/cross-do-join-latency.md) for detailed analysis.

### Checkpointing and Recovery

The platform supports exactly-once semantics through:
- Storage-backed deduplication
- Sequence numbers for ordering
- Fencing tokens for epoch protection
- Write-ahead logging

See [Exactly-Once Hibernation](./spikes/exactly-once-hibernation.md) and [Distributed Checkpoint Coordination](./spikes/distributed-checkpoint-coordination.md).

### Scheduling and Alarms

DO alarms provide at-least-once execution with millisecond precision. Key patterns:
- Single-alarm coalescing for multiple schedules
- Storage-persisted schedule state
- Catch-up policies for missed executions

See [Cron Hibernation](./spikes/cron-hibernation.md).

## Related Resources

### Code References

- `objects/` - Durable Object implementations
- `objects/DOBase.ts` - Core DO functionality
- `objects/transport/` - HTTP, RPC, MCP handlers
- `workflows/` - $ context DSL and scheduling
- `db/primitives/` - Query engine and state management

### External Documentation

- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [CLAUDE.md](../CLAUDE.md) - Development guide for Claude Code
