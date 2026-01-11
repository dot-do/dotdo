# Stateless DOs with Iceberg-Backed State: Spike Summary

**Epic:** `dotdo-4cwa4` - Stateless Durable Objects with Iceberg-Backed State
**Date:** 2026-01-11
**Status:** All P0 Spikes Complete - **Design Gate PASSED**

## Executive Summary

All five P0 spikes have been completed with **4 GO** decisions and **1 NO-GO (with viable alternative)**. The architecture for stateless DOs with externalized state is validated and ready for TDD implementation.

## Spike Results

| Issue | Spike | Decision | Key Finding |
|-------|-------|----------|-------------|
| `dotdo-a4pgw` | libSQL in workerd | **GO** | @libsql/client/web works with ~55ms cold, ~15ms warm |
| `dotdo-lzjyv` | DuckDB Iceberg WASM | **NO-GO/ALT** | Iceberg extension unavailable; use IcebergIndexAccelerator |
| `dotdo-2cmd6` | Parquet generation | **GO** | parquet-wasm: 2M+ rows/sec, 1.2MB bundle |
| `dotdo-kco6i` | Cold start latency | **GO** | P95 < 500ms target met (113ms for 100KB) |
| `dotdo-5sooo` | Cross-node consistency | **GO** | libSQL leader-follower + fencing tokens |
| `dotdo-jeoor` | Pipelines write path | **GO** | Alternative write path via R2 Data Catalog |

## Architecture Decision

```
┌─────────────────────────────────────────────────────────────────────┐
│                    STATELESS DURABLE OBJECT                          │
│                                                                      │
│  ┌────────────────────┐     ┌─────────────────────┐                 │
│  │ ConsistencyGuard   │     │ Application Logic   │                 │
│  │ (libSQL locks)     │     │                     │                 │
│  └─────────┬──────────┘     └──────────┬──────────┘                 │
│            │                            │                            │
│            ▼                            ▼                            │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │                    HOT STATE                             │        │
│  │                 libSQL/Turso                            │        │
│  │           (P50: 75ms, P95: 115ms)                       │        │
│  └─────────────────────────┬───────────────────────────────┘        │
│                            │                                         │
│            ┌───────────────┴───────────────┐                        │
│            ▼                               ▼                         │
│  ┌─────────────────────┐        ┌─────────────────────────┐         │
│  │  parquet-wasm       │        │  Pipelines Stream       │         │
│  │  (direct write)     │        │  (batched write)        │         │
│  └─────────┬───────────┘        └───────────┬─────────────┘         │
│            │                                 │                       │
└────────────│─────────────────────────────────│───────────────────────┘
             │                                 │
             ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        COLD STATE                                    │
│                    R2 + Iceberg                                      │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │                   R2 Data Catalog                        │        │
│  │  • Parquet files (ZSTD compressed)                      │        │
│  │  • Iceberg manifests (auto-managed via Pipelines)       │        │
│  │  • Snapshots for time travel                            │        │
│  │  • Compaction (128MB target)                            │        │
│  └─────────────────────────────────────────────────────────┘        │
│                            │                                         │
│                            ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐        │
│  │              IcebergIndexAccelerator                     │        │
│  │  • Partition pruning via min/max stats                  │        │
│  │  • Bloom filter lookups                                 │        │
│  │  • DuckDB WASM for in-memory query                      │        │
│  └─────────────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────────┘
```

## Performance Summary

### Cold Start Latency

| State Size | libSQL P95 | Iceberg P95 | Hybrid Prefetch P95 |
|------------|------------|-------------|---------------------|
| Empty | 98.8ms | N/A | N/A |
| 1KB | 91.6ms | N/A | N/A |
| **100KB** | **113.6ms** | 172.2ms | **63.5ms** |
| 1MB | 278.7ms | 402.6ms | N/A |

**Target: P95 < 500ms** - MET

### Parquet Write Performance

| Rows | Write Time | Output Size | Throughput |
|------|------------|-------------|------------|
| 1,000 | 0.58ms | 18.0KB | 1.7M rows/sec |
| 10,000 | 4.74ms | 176.2KB | 2.1M rows/sec |
| 50,000 | 16.92ms | 763.3KB | 2.95M rows/sec |

### Consistency Overhead

| Operation | Traditional DO | Stateless DO | Delta |
|-----------|----------------|--------------|-------|
| Cold start | 50-200ms | 0ms | -50-200ms |
| Write | <1ms | ~5ms | +5ms |
| Read (local) | <1ms | <1ms | 0ms |

## Implementation Recommendations

### Must Implement

1. **libSQL Hot State** - Use @libsql/client/web for low-latency reads/writes
2. **parquet-wasm** - For direct Parquet generation when needed
3. **ConsistencyGuard** - libSQL leader-follower with fencing tokens
4. **IcebergIndexAccelerator** - Continue using for query optimization

### Should Implement

5. **Connection Pooling** - 78.7% P95 reduction
6. **Edge Caching** - 100% P95 reduction for cache hits
7. **Read Replicas** - 72.5% P95 reduction
8. **Lazy Loading** - For state > 100KB

### Consider Implementing

9. **Pipelines Integration** - Alternative write path for cold storage
10. **Speculative Prefetch** - For predictable access patterns

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| DuckDB Iceberg extension unavailable | IcebergIndexAccelerator + R2 bindings |
| Write latency overhead | Accept 5ms for consistency guarantees |
| Pipelines beta stability | Fallback to parquet-wasm |
| Large state cold start | Lazy loading + prefetch |

## Files Created

| File | Purpose |
|------|---------|
| `db/spikes/libsql-worker-poc.ts` | libSQL Workers POC |
| `db/spikes/libsql-workerd-spike-results.md` | libSQL findings |
| `db/spikes/duckdb-iceberg-spike-results.md` | DuckDB Iceberg findings |
| `db/spikes/parquet-generation-spike-results.md` | Parquet generation findings |
| `db/spikes/parquet-benchmark.ts` | Parquet benchmark suite |
| `db/spikes/parquet-edge-poc.ts` | Edge Parquet POC |
| `db/spikes/cold-start-benchmark.ts` | Cold start benchmark framework |
| `db/spikes/cold-start-spike-results.md` | Cold start findings |
| `db/spikes/consistency-analysis.md` | Consistency options analysis |
| `db/spikes/consistency-poc.ts` | Consistency guard implementation |
| `db/spikes/consistency-spike-results.md` | Consistency findings |
| `db/spikes/pipelines-write-path-design.md` | Pipelines architecture design |
| `db/spikes/SPIKE-SUMMARY.md` | This summary |

## Next Steps

1. **TDD Implementation** - Begin with libSQL Storage layer (Red-Green-Refactor)
2. **Pipelines POC** - Validate end-to-end with single DO type
3. **Container Deployment** - Dockerfile + Helm for multi-cloud
4. **CLI Integration** - Local cluster with tunnel support
