# Research Spikes

Research spikes investigate specific technical challenges in the dotdo platform and propose solutions. Each spike follows a consistent format with executive summary, analysis, recommendations, and references.

## Status Summary (2026-01-13 Review)

**Total Spikes:** 22
- **Complete:** 21 (95%)
- **Proposed:** 1 (5%)

All critical spikes have been completed with comprehensive documentation including clear conclusions, implementation approaches with code examples, success criteria validation, and follow-up action items.

### Implementation Priority

The following spikes have actionable next steps ready for implementation:

| Priority | Spike | Key Implementation | Status |
|----------|-------|-------------------|--------|
| P0 | Pre-Aggregation Storage | Hot tier SQLite + State combinators | Ready |
| P0 | Cost Estimation | Hybrid approach with HLL + feedback | Ready |
| P1 | Real-time vs Cached Routing | Staleness budget + QuerySourceRouter | Ready |
| P1 | Distributed Checkpoint | Chandy-Lamport adapted for DOs | Ready |
| P2 | parquet-wasm Iceberg PoC | Bundle reduction investigation | Proposed |

## Index by Category

### Durable Object Patterns

These spikes cover patterns for working with Cloudflare Durable Objects including hibernation, scheduling, and lifecycle management.

| Spike | Issue | Status | Key Finding |
|-------|-------|--------|-------------|
| [Cron Hibernation](./cron-hibernation.md) | dotdo-jkfp6 | Complete | Alarms persist through hibernation; alarm granularity < 1s |
| [Exactly-Once Hibernation](./exactly-once-hibernation.md) | dotdo-rn3gf | Complete | Checkpoint-before-emit + idempotent writes with sequence numbers |
| [Long-Running Tasks](./long-running-tasks.md) | dotdo-ff8iu | Complete | CPU limits configurable to 5min via limits.cpu_ms; wall-clock unlimited |
| [State Recovery Latency](./state-recovery-latency.md) | dotdo-wtwsf | Complete | SQLite < 10ms recovery; R2 100-300ms; lazy loading recommended |

**Key Insights:**
- DO alarms provide at-least-once execution with millisecond precision
- In-memory state is lost on hibernation - use DO storage for persistence
- CPU time is the constraint, not wall clock - waiting on I/O is free
- Cloudflare Workflows provide native solution for durable multi-step execution

### Distributed Query Processing

These spikes analyze patterns for federated queries across multiple Durable Objects.

| Spike | Issue | Status | Key Finding |
|-------|-------|--------|-------------|
| [Cross-DO Join Latency](./cross-do-join-latency.md) | dotdo-y6kfh | Complete | 3-5 DOs < 500ms same-colo; parallel fan-out to 10 DOs feasible |
| [Broadcast Join Strategy](./broadcast-join-strategy.md) | dotdo-wk6p0 | Complete | Optimal for < 10K rows; single round-trip with Cap'n Web pipelining |
| [Distributed Checkpoint Coordination](./distributed-checkpoint-coordination.md) | dotdo-woo4p | Complete | < 100ms for 5-DO checkpoint (same-colo); Chandy-Lamport adapted |

**Key Insights:**
- Same-colo DO calls: ~2-5ms p50, cross-colo: ~50-150ms p50
- Broadcast joins optimal when one side < 10,000 rows
- Single-threaded DO execution simplifies checkpointing (no barrier alignment)
- Parallel fan-out can query up to 10 DOs within 500ms even cross-colo

### State Management

These spikes cover checkpoint and recovery patterns for stateful streaming operations.

| Spike | Issue | Status | Key Finding |
|-------|-------|--------|-------------|
| [Checkpoint Size Limits](./checkpoint-size-limits.md) | dotdo-v5rxt | Complete | 50-100 MB safe target; R2 overflow for large state |
| [Memory Limits Intermediate Results](./memory-limits-intermediate-results.md) | dotdo-ck97t | Complete | Streaming + backpressure + spill to SQLite |

**Key Insights:**
- SQLite-backed DOs: 10 GB total, 2 MB per key/value/row
- Practical checkpoint budget: 50-100 MB safe target
- Use chunked checkpoints with R2 overflow for large state
- Existing BackpressureController supports BUFFER_TO_DISK strategy

### Multi-Tenancy and Isolation

These spikes analyze patterns for tenant isolation and resource management.

| Spike | Issue | Status | Key Finding |
|-------|-------|--------|-------------|
| [Multi-Tenant Semantic Isolation](./multi-tenant-semantic-isolation.md) | dotdo-pmgiv | Complete | Per-tenant DO + namespace separation + RLS for shared infra |
| [Rate Limiting Isolates](./rate-limiting-isolates.md) | dotdo-bvnhp | Complete | Token bucket in DO storage; sliding window hybrid |
| [OAuth Token Management](./oauth-token-management.md) | dotdo-b7d0v | Complete | Proactive refresh; encrypted storage; token rotation |

**Key Insights:**
- Per-tenant DOs provide complete data isolation
- Namespace prefixes prevent cross-tenant access
- Hybrid approach: per-tenant DOs + platform aggregation layer with consent
- < 10% performance overhead with namespace caching

### Data Pipeline

These spikes cover data pipeline patterns including DAG scheduling and catalog management.

| Spike | Issue | Status | Key Finding |
|-------|-------|--------|-------------|
| [Pipelines R2 Catalog](./pipelines-r2-catalog.md) | dotdo-c77gq | Complete | REST API for Iceberg commits; scan planning via R2 Data Catalog |
| [Cross-DAG Dependency Triggers](./cross-dag-dependency-triggers.md) | dotdo-a1b2c | Complete | Event-driven triggers via DO pub/sub; DAG versioning |
| [WAL Parsing JS](./wal-parsing-js.md) | dotdo-v9dhs | Complete | SQLite journal_mode=WAL + change capture; lightweight CDC |

**Key Insights:**
- R2 Data Catalog provides managed Iceberg metadata
- Cross-DAG dependencies use event-based triggers
- WAL parsing enables lightweight change data capture

### Query Engine

These spikes analyze query optimization and execution patterns.

| Spike | Issue | Status | Key Finding |
|-------|-------|--------|-------------|
| [Cost Estimation Without Statistics](./cost-estimation-without-statistics.md) | dotdo-ymh9w | Complete | Hybrid: HLL + feedback + sampling achieves 90% within 10x |
| [Real-Time vs Cached Query Routing](./real-time-vs-cached-query-routing.md) | dotdo-qy64m | Complete | Staleness budget with stale-while-revalidate pattern |
| [Large Dataset Pagination](./large-dataset-pagination.md) | dotdo-cupcq | Complete | Cursor-based + checkpoints for 1M+ row syncs |
| [Pre-Aggregation Storage](./pre-aggregation-storage.md) | dotdo-60sbd | Complete | Tiered: SQLite (hot) + Parquet (warm) + Iceberg (cold) |

**Key Insights:**
- Cost estimation pipeline: feedback cache -> HLL/histogram -> partition stats -> sampling -> heuristics
- Query routing: cached < 100ms, real-time < 2s targets
- Cursor pagination with checkpoint per page for resumability
- ClickHouse-style state combinators for incremental aggregation

### Vector Search and Embeddings

These spikes cover vector search infrastructure and configuration.

| Spike | Issue | Status | Key Finding |
|-------|-------|--------|-------------|
| [Vector Search Infrastructure](./vector-search-infrastructure.md) | dotdo-pzq97 | Complete | Vectorize for production; SQLite vec for dev/testing |
| [Embedding Model Selection](./embedding-model-selection.md) | dotdo-ks4mv | Complete | BGE-base for balance; text-embedding-3-small for quality |
| [Similarity Threshold Calibration](./similarity-threshold-calibration.md) | dotdo-t0b42 | Complete | 0.7-0.8 cosine similarity for semantic matching |

**Key Insights:**
- Production: Cloudflare Vectorize with edge replication
- Development: SQLite vec extension for fast iteration
- BGE-base-en-v1.5 provides best balance of size/quality
- Similarity thresholds vary by use case (exact match vs semantic)

### Performance

These spikes analyze performance optimization patterns.

| Spike | Issue | Status | Key Finding |
|-------|-------|--------|-------------|
| [Cascade Parallelization DO Routing](./cascade-parallelization-do-routing.md) | dotdo-brzfm | Complete | Promise.all + dependency analysis for parallel execution |

**Key Insights:**
- CascadeExecutor separates independent vs dependent operations
- PipelinePromise captures expressions for parallel analysis
- BulkheadCircuitBreaker provides category isolation

### Iceberg Integration

| Spike | Issue | Status | Key Finding |
|-------|-------|--------|-------------|
| [parquet-wasm Iceberg PoC](./parquet-wasm-iceberg-poc.md) | - | Proposed | Bundle reduction 19MB -> 6.3MB; needs investigation |

## Cross-References

### Spike Dependencies

Some spikes build on findings from others:

```
Exactly-Once Hibernation
    references -> Cron Hibernation (alarm patterns)
    references -> Checkpoint Size Limits (storage strategies)

Distributed Checkpoint Coordination
    references -> Cross-DO Join Latency (latency budgets)
    references -> Exactly-Once Hibernation (deduplication)

Broadcast Join Strategy
    references -> Cross-DO Join Latency (cost model)
    references -> Checkpoint Size Limits (memory limits)

Multi-Tenant Semantic Isolation
    references -> Cross-DO Join Latency (query performance)

Pre-Aggregation Storage
    references -> Cross-DO Join Latency (latency budgets)
    references -> Memory Limits Intermediate Results (spill strategies)

Real-Time vs Cached Query Routing
    references -> Pre-Aggregation Storage (tiered approach)
    references -> Cost Estimation Without Statistics (query cost)
```

### Related Architecture Documents

- [Architecture Overview](../architecture.md) - Main architecture documentation
- [DOBase Decomposition](../architecture/dobase-decomposition.md) - DO class structure

### Related Code

| Directory | Description |
|-----------|-------------|
| `objects/` | Durable Object implementations |
| `objects/persistence/` | Checkpoint and state management |
| `workflows/` | Scheduling and event handling |
| `db/primitives/` | Query engine and state backends |
| `db/primitives/stateful-operator/` | Streaming operator state |
| `db/primitives/semantic-layer/` | Semantic query layer |
| `db/primitives/cdc/` | Change data capture and backpressure |
| `db/iceberg/` | Iceberg table integration |

## Spike Template

New spikes should follow this structure:

```markdown
# [Title]

**Issue:** dotdo-xxxxx
**Date:** YYYY-MM-DD
**Author:** Research Spike
**Status:** PROPOSED | IN_PROGRESS | COMPLETE

## Executive Summary
[Key findings and recommendations in 2-3 paragraphs]

### Success Criteria

| Criteria | Target | Result |
|----------|--------|--------|
| {criterion 1} | {target} | {result} |

## Background
[Problem context and existing codebase analysis]

## Analysis
[Detailed investigation with code examples]

## Recommendations
[Prioritized action items]

## Next Steps
1. [Implementation action 1]
2. [Implementation action 2]

## See Also
[Links to related spikes, architecture docs, and code]

## References
[External documentation and research papers]
```
