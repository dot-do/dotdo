# Cold Start Latency Benchmark Results

**Issue:** `dotdo-kco6i`
**Timestamp:** 2026-01-11T14:58:47.261Z
**Environment:** Cloudflare Workers
**Target:** P95 < 500ms
**Decision:** GO - Target met with all strategies

## Executive Summary

Cold start latency for stateless DOs loading state from external storage **meets the target** of P95 < 500ms across all tested scenarios. The hybrid prefetch strategy achieves P95 of **63.5ms** for 100KB state.

## Summary

- **Meets Target:** YES
- **Fastest Scenario (100KB):** Hybrid - Prefetch (background hydration)

## Latency Results

| Scenario | State Size | P50 | P95 | P99 | Mean | Samples |
|----------|------------|-----|-----|-----|------|---------|
| libSQL - empty state | empty | 67.6ms | 98.8ms | 102.9ms | 73.5ms | 50 |
| libSQL - 1KB state | 1KB | 74.8ms | 91.6ms | 93.0ms | 72.8ms | 50 |
| **libSQL - 100KB state** | **100KB** | **89.0ms** | **113.6ms** | **117.4ms** | **89.4ms** | **50** |
| libSQL - 1MB state | 1.0MB | 257.8ms | 278.7ms | 285.5ms | 256.4ms | 50 |
| Iceberg - Single Parquet file | 100KB | 146.1ms | 172.2ms | 173.9ms | 147.1ms | 50 |
| Iceberg - Multiple Parquet files (10) | 1.0MB | 369.0ms | 402.6ms | 405.1ms | 371.2ms | 50 |
| **Iceberg - Lazy loading** | **1.0MB** | **63.2ms** | **79.5ms** | **84.4ms** | **62.4ms** | **50** |
| Hybrid - Cache hit (libSQL) | 100KB | 85.0ms | 111.2ms | 113.1ms | 87.4ms | 50 |
| Hybrid - Cache miss (Iceberg) | 100KB | 216.8ms | 249.7ms | 254.8ms | 216.6ms | 50 |
| **Hybrid - Prefetch** | **100KB** | **44.6ms** | **63.5ms** | **68.1ms** | **45.1ms** | **50** |

## Key Insights

### 1. libSQL Scales Well

State size scaling is roughly linear:
- Empty → 100KB: +15ms P95
- 100KB → 1MB: +165ms P95

100KB state (typical DO) remains well under 500ms target.

### 2. Lazy Loading is Critical for Large State

For 1MB state, lazy loading (metadata only) achieves **79.5ms P95** vs full load at **402.6ms P95**.

**Recommendation:** Always use lazy loading for DOs with large state.

### 3. Prefetch Wins for Predictable Access

The hybrid prefetch strategy (background hydration while serving from cache) achieves the best results at **63.5ms P95**.

**Recommendation:** Implement speculative prefetch for frequently accessed DOs.

## Latency Breakdown (Mean)

| Scenario | Connection | Query | Network | Parse | Deserialize |
|----------|------------|-------|---------|-------|-------------|
| libSQL - empty state | 56.1ms | 16.1ms | -ms | 1.3ms | -ms |
| libSQL - 1KB state | 55.6ms | 15.9ms | -ms | 1.3ms | -ms |
| libSQL - 100KB state | 56.0ms | 21.1ms | -ms | 12.2ms | -ms |
| libSQL - 1MB state | 54.3ms | 67.6ms | -ms | 134.5ms | -ms |
| Iceberg - Single Parquet | -ms | -ms | 74.5ms | 51.3ms | 21.3ms |
| Iceberg - Multiple Parquet | -ms | -ms | 118.5ms | 151.4ms | 101.4ms |
| Iceberg - Lazy loading | -ms | -ms | 56.4ms | 5.9ms | -ms |
| Hybrid - Cache hit | 53.9ms | 21.0ms | -ms | 12.4ms | -ms |
| Hybrid - Cache miss | 70.4ms | -ms | 73.4ms | 51.4ms | 21.3ms |
| Hybrid - Prefetch | 51.9ms | -ms | 32.1ms | -ms | -ms |

## Optimization Analysis

| Strategy | Baseline P95 | Optimized P95 | Improvement | Recommendation |
|----------|--------------|---------------|-------------|----------------|
| Connection Pooling | 108.4ms | 23.1ms | **78.7%** | ADOPT |
| Edge Caching | 169.1ms | 0.0ms | **100.0%** | ADOPT |
| Read Replicas | 105.7ms | 29.1ms | **72.5%** | ADOPT |

## Recommendations

### Must Implement

1. **Connection Pooling** - 78.7% P95 reduction
   - Reuse libSQL connections within DO lifecycle
   - Significant win for negligible complexity

2. **Edge Caching** - 100% P95 reduction for cache hits
   - Cache frequently accessed DO state in Worker memory
   - Implement LRU eviction based on access patterns

3. **Read Replicas** - 72.5% P95 reduction
   - Use Turso read replicas at edge locations
   - Route reads to nearest replica

### Consider Implementing

4. **Lazy Loading** - Load only metadata, fetch state on-demand
   - Critical for large state (>100KB)
   - Adds complexity but major latency savings

5. **Speculative Prefetch** - Background hydration based on predictions
   - Best results when access patterns are predictable
   - Requires analytics/heuristics

## Decision

**GO** - Proceed with stateless DO architecture. Cold start latency is well within target.

### Architecture Decision

Use the **Hybrid approach**:
- **Hot path (libSQL):** For typical operations with 100KB state
- **Cold path (Iceberg):** For large state, historical data, analytics
- **Lazy loading:** Always for state > 100KB
- **Prefetch:** For predictable access patterns

## Files Created

| File | Purpose |
|------|---------|
| `db/spikes/cold-start-benchmark.ts` | Benchmark framework |
| `db/spikes/cold-start-benchmark.test.ts` | Test harness |
| `db/spikes/run-benchmark.ts` | CLI runner |
| `db/spikes/cold-start-spike-results.md` | This document |
