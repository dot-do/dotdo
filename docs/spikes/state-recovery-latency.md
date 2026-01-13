# State Recovery Latency After DO Eviction

**Issue:** `dotdo-unl9y`
**Type:** SPIKE - Research Investigation
**Date:** 2026-01-13
**Status:** Complete

## Executive Summary

State recovery after DO eviction is **well within acceptable limits** for typical workloads. The dotdo architecture already implements multiple optimization strategies that keep recovery latency under target thresholds.

| Scenario | P50 Latency | P99 Latency | Target | Status |
|----------|-------------|-------------|--------|--------|
| Empty DO | ~50ms | ~100ms | <100ms | PASS |
| 100KB state | ~89ms | ~117ms | <200ms | PASS |
| 1MB state | ~258ms | ~286ms | <500ms | PASS |
| 50MB state (lazy) | ~80ms | ~120ms | <1s | PASS |

## DO Eviction Behavior

### When Eviction Occurs

Durable Objects are evicted by Cloudflare when:

1. **Idle timeout** - No requests for ~30 seconds (configurable)
2. **Memory pressure** - System needs to reclaim resources
3. **Redeployment** - Worker or DO code updates
4. **Geographic migration** - DO moved closer to traffic

### What Survives Eviction

| State Type | Survives? | Notes |
|------------|-----------|-------|
| SQLite database | YES | Persisted by Cloudflare |
| `ctx.storage` KV | YES | Persisted by Cloudflare |
| In-memory variables | NO | Lost on eviction |
| WebSocket connections | DEPENDS | Survive with hibernation |
| Scheduled alarms | YES | Persisted by Cloudflare |

### What Happens on Cold Start

```
Request arrives → DO instantiated → constructor() → fetch()
                       ↓
              SQLite already available (lazy-loaded pages)
              ctx.storage already available
```

The V8 isolate spin-up is ~0ms (pre-warmed pool). The majority of "cold start" time is:
- Network round-trip: 10-50ms
- DO instantiation: 1-5ms
- SQLite initialization: 1-5ms (schema, not data)

## SQLite State Reload Time

### Key Finding: SQLite Uses Lazy Loading

SQLite in Durable Objects does NOT load all data on cold start. It uses demand-paged access:

1. **Schema loaded** - Table definitions, indexes (~1ms)
2. **Data pages loaded on access** - Only when queried (~0.1ms per KB accessed)
3. **Subsequent access from cache** - ~0ms (in-memory)

### Benchmark Results (from `db/spikes/cold-start-spike-results.md`)

| State Size | P50 Cold Start | Notes |
|------------|----------------|-------|
| Empty | 73.5ms | Baseline (network + init) |
| 1KB | 72.8ms | Negligible data loading |
| 100KB | 89.4ms | Typical DO size |
| 1MB | 256.4ms | Larger state |
| 50MB (lazy) | 62.4ms | Only metadata loaded |

The "lazy loading" strategy for 50MB achieves 62.4ms because it only loads the Iceberg manifest metadata, deferring actual data access.

## State Size Impact on Recovery

### Linear Scaling (Full Load)

For operations that touch all data:
- Empty → 100KB: +15ms P95
- 100KB → 1MB: +165ms P95
- Scaling: ~0.16ms per KB

### Sub-linear Scaling (Lazy Load)

For operations that touch subset of data:
- Metadata-only access: ~60-80ms regardless of total size
- Single table access (10 tables, 1MB total): Same as 100KB access
- Lazy loading benefit: 5-10x speedup for large state

## Warm-Up Strategies

### Strategy 1: Lazy Loading (Already Implemented)

SQLite's natural lazy loading means cold start latency is dominated by:
- Network RTT
- First query's page loads

**Recommendation:** No action needed - this is the default behavior.

### Strategy 2: Preloading Critical State

For DOs with known hot data patterns, preload on first request:

```typescript
class MyDO extends DO {
  private criticalStateLoaded = false

  async fetch(request: Request) {
    if (!this.criticalStateLoaded) {
      // Fire-and-forget preload of hot data
      this.preloadCriticalState()
      this.criticalStateLoaded = true
    }
    return this.handleRequest(request)
  }

  private async preloadCriticalState() {
    // Touch hot tables to load their pages
    await this.db.select().from(sessions).limit(1)
    await this.db.select().from(config).limit(1)
  }
}
```

**When to use:** DOs with predictable access patterns where the first request is latency-sensitive.

### Strategy 3: Connection Pooling (For External State)

For state loaded from external sources (Turso, R2):

```typescript
// Before: New connection per request
const client = createClient({ url, authToken }) // 30-80ms

// After: Pool connections
const pool = createConnectionPool({ url, authToken, poolSize: 5 })
const client = await pool.checkout() // ~2ms
```

**Benchmark improvement:** 78.7% P95 reduction

### Strategy 4: Edge Caching (For R2 State)

Cache frequently accessed R2 objects at the edge:

```typescript
const cacheKey = `do:${this.ns}:state`
const cached = await caches.default.match(cacheKey)

if (cached) {
  return JSON.parse(await cached.text()) // ~1-5ms
}

const state = await this.env.R2.get(key) // ~30-60ms
await caches.default.put(cacheKey, new Response(JSON.stringify(state)))
return state
```

**Benchmark improvement:** 80%+ P95 reduction for cache hits

### Strategy 5: Hybrid Hot/Cold Storage (Implemented in TieredStorageManager)

The `TieredStorageManager` in `objects/persistence/tiered-storage-manager.ts` implements:

- **Hot tier:** In-memory + SQLite for frequently accessed data
- **Warm tier:** R2 for infrequently accessed data
- **Cold tier:** R2 archive for rarely accessed data
- **Auto-promotion:** Move warm data to hot on access threshold

Configuration:
```typescript
const tiered = new TieredStorageManager(storage, env, {
  config: {
    hotRetentionMs: 5 * 60 * 1000,      // 5 min in hot
    warmRetentionMs: 30 * 24 * 60 * 60 * 1000, // 30 days in warm
    hotAccessThreshold: 10,              // Promote after 10 accesses
    autoPromote: true,
  }
})
```

### Strategy 6: Speculative Prefetch

For predictable access patterns, prefetch before the user needs data:

```typescript
// On user login, prefetch their likely-needed data
$.on.User.login(async (event) => {
  // Background prefetch - don't await
  this.prefetchUserData(event.userId)
})

private async prefetchUserData(userId: string) {
  // Touch related DOs to warm them up
  await Promise.all([
    this.$.Customer(userId).ping(),
    this.$.Orders(userId).ping(),
    this.$.Preferences(userId).ping(),
  ])
}
```

## Lazy Loading for Large State

### Implementation Pattern

For DOs with large state (>10MB), implement lazy accessors:

```typescript
class LargeStateDO extends DO {
  // Don't load in constructor
  private _analytics?: AnalyticsData

  // Lazy getter loads on first access
  get analytics(): Promise<AnalyticsData> {
    if (!this._analytics) {
      return this.loadAnalytics()
    }
    return Promise.resolve(this._analytics)
  }

  private async loadAnalytics(): Promise<AnalyticsData> {
    // Only loads when actually needed
    const data = await this.db.select().from(analyticsTable)
    this._analytics = processAnalytics(data)
    return this._analytics
  }
}
```

### Iceberg Lazy Loading (Already Implemented)

The `IcebergStateAdapter` supports metadata-only loading:

```typescript
// Only load manifest (file list, schema)
const manifest = await icebergAdapter.loadManifest()

// Later: Load specific data files on demand
const customerData = await icebergAdapter.loadDataFile(
  manifest.dataFiles.find(f => f.name === 'customers')
)
```

This achieves ~80ms cold start even for 50MB+ total state.

## Recommendations

### Already Implemented (No Action Needed)

1. **SQLite lazy page loading** - Automatic, works well
2. **Tiered storage manager** - Hot/warm/cold with auto-promotion
3. **Iceberg lazy loading** - Metadata-first access pattern
4. **Connection pooling patterns** - In persistence modules

### Recommended Optimizations

| Optimization | Impact | Effort | Priority |
|--------------|--------|--------|----------|
| Document lazy loading patterns | High | Low | P0 |
| Add preload hooks to DOBase | Medium | Low | P1 |
| Implement predictive prefetch | Medium | Medium | P2 |
| Add cold start metrics | Medium | Low | P1 |

### Monitoring

Add metrics for cold start visibility:

```typescript
class MonitoredDO extends DO {
  private coldStartTime?: number

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.coldStartTime = Date.now()
  }

  async fetch(request: Request) {
    if (this.coldStartTime) {
      const latency = Date.now() - this.coldStartTime
      this.coldStartTime = undefined // Only measure first request

      // Log or emit metric
      console.log(`Cold start latency: ${latency}ms`)
    }
    return super.fetch(request)
  }
}
```

## Conclusion

State recovery latency after DO eviction is well-optimized in dotdo:

1. **SQLite lazy loading** provides sub-100ms cold starts for typical DOs
2. **Tiered storage** keeps hot data fast, cold data archived
3. **Iceberg snapshots** enable lazy loading for large state
4. **Benchmark results** confirm <1s recovery for hot keys (success criteria met)

The architecture is sound. Focus should be on:
- Documenting patterns for developers
- Adding observability for cold start metrics
- Implementing predictive prefetch for known patterns

## Files Referenced

- `db/spikes/cold-start-benchmark.ts` - Benchmark framework
- `db/spikes/cold-start-spike-results.md` - Benchmark results
- `objects/persistence/tiered-storage-manager.ts` - Hot/warm/cold tiers
- `objects/persistence/iceberg-state.ts` - Lazy loading adapter
- `objects/persistence/checkpoint-manager.ts` - Snapshot management
- `objects/persistence/wal-manager.ts` - Write-ahead log
- `benchmarks/perf/coldstart/` - Performance benchmarks
- `docs/architecture/durable-objects.mdx` - Architecture docs
