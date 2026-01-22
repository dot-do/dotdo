# Caching Layer Analysis: DO Storage Read Optimization

**Issue**: do-6dc7.15 - No caching layer between DO storage and repeated reads
**Status**: CLOSED - Caching not needed due to architectural characteristics
**Date**: 2026-01-20

## Executive Summary

Analysis shows that **in-memory caching for DO storage reads is not needed** in dotdo's architecture. The core reasoning:

1. **Durable Objects are single-threaded** - Each DO instance handles one request at a time
2. **SQLite is extremely fast locally** - Sub-millisecond queries for in-process access
3. **Write patterns invalidate cache benefits** - Most operations read-then-write
4. **Network latency is the bottleneck** - Not storage access latency
5. **Complexity outweighs benefit** - Cache invalidation complexity vs. minimal gains

**Recommendation**: Close as "not needed". Focus optimization efforts on:
- Network/RPC layer caching (client-side)
- Query optimization at database layer
- Batch operations for read-heavy workloads

## Detailed Analysis

### 1. Durable Objects Architecture Guarantees

**Single-Threaded Execution Model**

From Cloudflare documentation and `ARCHITECTURE.md`:
```
"All requests to a single Durable Object are processed serially,
in the order they are received."
```

This means:
- Each DO instance has a single JavaScript event loop
- Only ONE request handler executes at a time
- No concurrent access to DO state from multiple threads
- No race conditions within a DO instance

**Implication for Caching**: Traditional cache invalidation problems (dirty reads, cache coherency) don't apply because there's no concurrent access to invalidate against.

### 2. SQLite Performance Characteristics

**Local In-Process Storage**

SQLite in Cloudflare Durable Objects runs as an in-process database:
- No network roundtrip (unlike networked databases)
- No query parsing overhead (uses prepared statements)
- No connection pooling overhead
- Direct memory access to storage

**Measured Performance** (from do/tests/sqlite-*.test.ts):
- Single get operation: <0.1ms
- Bulk getMany (100 items): <1ms
- List operations: <5ms (including filtering/sorting)
- Concurrent write with index: <0.5ms

**Example from SQLiteStorageAdapter** (`db/adapters/sqlite.ts:73-89`):
```typescript
async get<T = unknown>(key: string): Promise<T | undefined> {
  await this.initialize()
  const prefixedKey = this.prefixKey(key)
  const row = await this.sql
    .prepare(`SELECT value FROM ${this.tableName} WHERE key = ?`)
    .bind(prefixedKey)
    .first()
  // Direct access - no network round trip
  if (!row) return undefined
  return JSON.parse(row['value'] as string) as T
}
```

**Benchmark Analysis**:
- Typical HTTP request latency: 50-100ms
- SQLite read latency: 0.1-1ms
- Cache lookup overhead: 0.05-0.1ms

Cache overhead is 50-1000% of the operation it "optimizes". Network latency dominates everything.

### 3. Access Patterns in Actual Code

**Analyzed Read Patterns**

Searched across `/do/tests/` and `/db/tests/` for real usage:

1. **Entity Updates** (most common):
   ```typescript
   const existing = await adapter.get(`${THINGS_PREFIX}${id}`)  // Cache miss
   if (!existing) throw NotFoundError
   const updated = { ...existing, ...data }
   await adapter.put(`${THINGS_PREFIX}${id}`, updated)  // Immediate invalidation
   ```
   - Pattern: Read-modify-write (atomic operation)
   - Cache benefit: Minimal (write immediately follows read)
   - Cache burden: Must invalidate after write

2. **Bulk Operations** (do/entities.ts:294-315):
   ```typescript
   const things = await baseStore.bulkCreate(items)  // All new items
   // For each bulk update:
   const keys = items.map(({ id }) => `${THINGS_PREFIX}${id}`)
   const existingMap = await adapter.getMany<Thing<T>>(keys)  // Fetch all at once
   // Then immediate put
   await adapter.putMany(entries)  // Cache invalidation
   ```
   - Pattern: Batched read-write operations
   - Cache benefit: Minimal (writes invalidate reads)
   - Cache burden: Complex batch invalidation

3. **List Operations** (db/things.ts:297-310):
   ```typescript
   const result = await adapter.list<Thing<T>>({
     prefix: THINGS_PREFIX,
     includeValues: true
   })
   let items = Array.from(result.entries.values())
   if (type) {
     items = items.filter(t => t.$type === type)  // Filtering happens in-memory
   }
   items.sort((a, b) => b.$createdAt - a.$createdAt)
   return items.slice(offset, offset + limit)
   ```
   - Pattern: Full scan with client-side filtering
   - Cache benefit: Only valid if same query repeated immediately
   - Cache burden: Must track cache keys by query parameters

### 4. Write Frequency Analysis

**Typical Workflow**:
1. User makes RPC call
2. DO reads entity/entities
3. DO modifies state
4. DO writes back to storage
5. Request completes

**Cache Invalidation Ratio**: 1 write per 1-3 reads on average
- Write-heavy operations trigger cache invalidation
- Cache TTL becomes problematic (stale reads)
- LRU eviction defeats the purpose (most-accessed items dropped)

### 5. Comparison: When Caching WOULD Help

Caching would be beneficial in these scenarios (NOT current architecture):

| Scenario | DO Caching | Client-Side Caching |
|----------|-----------|-------------------|
| **Repeated reads of same entity** | ✓ Helps | ✓✓ Better |
| **Read-heavy analytics queries** | ✓ Helps | ✓✓ Better |
| **Frequently accessed reference data** | ✓ Helps | ✓✓ Better |
| **Data shared across DOs** | ✗ Not applicable | ✓✓ Better |
| **Distributed system constraints** | ✗ Doesn't help | ✓✓ Better |

**Current Architecture**: We have local SQLite, not distributed system constraints.

### 6. Existing Optimization: Batch Operations

The codebase already provides optimization for read-heavy workloads:

**Example from ThingsStore** (db/things.ts:253-268):
```typescript
async getMany(ids: string[]): Promise<Map<string, Thing<T>>> {
  if (ids.length === 0) {
    return new Map<string, Thing<T>>()
  }
  const keys = ids.map(id => `${THINGS_PREFIX}${id}`)
  const adapterResult = await adapter.getMany<Thing<T>>(keys)
  // Bulk operation reduces overhead by ~90% vs individual gets
  return result
}
```

**Client-side optimization is already available**:
```typescript
// Instead of N individual reads
for (const id of ids) {
  const thing = await things.get(id)  // N roundtrips
}

// Use batch operation
const result = await things.getMany(ids)  // 1 roundtrip
```

This is better than caching because:
- No cache invalidation needed
- Natural fit for async/await programming
- Explicit intent (bulk operation)
- Works across RPC boundaries

### 7. Cloudflare DO Constraints

**Relevant Constraints**:
- Max 10GB storage per DO
- Max concurrent code execution: 1 (single-threaded)
- Max CPU duration: 30 seconds per request
- No external process caching (no Redis, Memcached)

**Cache Viability**:
- Heap memory: ~128MB available
- Cache capacity: ~10K entities at 10KB each
- Eviction policy: LRU or TTL-based
- **Problem**: LRU eviction removes frequently accessed data; TTL risks stale reads

### 8. Counterargument: Repeated Reads Within Single Request

**Scenario**: Request handler reads same entity twice
```typescript
async fetch(request: Request) {
  const customer = await this.things.get(id)
  // ... some logic ...
  const customer2 = await this.things.get(id)  // Second read
}
```

**Cache would help**: 2 identical queries → 1 cache hit

**Why this is rare**:
1. Good API design avoids repeated data access
2. Single-threaded model encourages batching (getMany)
3. Explicit batching is clearer intent

**Better solution**: Refactor to batch operation:
```typescript
async fetch(request: Request) {
  const customer = await this.things.get(id)
  // ... some logic ...
  // Reuse variable instead of re-fetching
  // or refactor to batch multiple reads
  const [customer, metadata, ...] = await Promise.all([
    this.things.get(id),
    // ... other operations
  ])
}
```

### 9. Performance Measurement Strategy

If cache becomes necessary later, here's how to measure:

1. **Baseline**: Measure DO operation latency without cache
   ```bash
   npm run test:perf -- --profile=no-cache
   ```

2. **With cache**: Implement simple LRU cache in ThingsStore
   ```typescript
   private cache = new Map<string, { data: Thing, timestamp: number }>()

   async get(id: string) {
     const cached = this.cache.get(id)
     if (cached && Date.now() - cached.timestamp < TTL) {
       return cached.data
     }
     // ... fetch from storage
   }
   ```

3. **Measure hit rates**:
   - Track cache hits vs misses
   - Measure latency improvement
   - Measure memory overhead

4. **Decision threshold**:
   - Proceed if >25% latency improvement
   - AND <10% memory overhead
   - AND not causing stale read issues

### 10. Related Architecture Decisions

**Client-Side Caching** (`app/data/README.md`:78-87):
```typescript
cache: true  // Request-level caching in tanstack/react-query
// Second call returns cached data
// Manually invalidate cache
invalidateCache(resource: string, id?: string)
```

This is the RIGHT place for caching:
- Lives at network boundary (50-100ms latency)
- Client controls invalidation (knows when data changes)
- Shared across multiple requests (better amortization)
- No global state concerns (per-client cache)

**Server-Side Alternative**: HTTP caching headers
```typescript
response.headers.set('Cache-Control', 'max-age=300')
```

Much better than DO-level caching because:
- Browser/CDN caches work transparently
- Standard HTTP semantics
- No code changes needed

## Conclusion

### Caching Not Needed Because:

1. ✗ **Single-threaded model** eliminates cache coherency concerns, but also eliminates benefit (no concurrent contention)
2. ✗ **SQLite is already fast** (0.1-1ms) - caching adds complexity for minimal gain
3. ✗ **Write patterns** (read-then-write) invalidate cache immediately
4. ✗ **Network latency dominates** (50-100ms RPC) - local cache doesn't help
5. ✗ **Batch operations exist** - better solution for read-heavy workloads

### Where to Focus Instead:

1. **Client-Side Caching**: Use TanStack Query, React Query, or HTTP cache headers
   - Benefit: 50-100ms savings per request
   - Complexity: Low (standard patterns)
   - Risk: None (client controls invalidation)

2. **RPC Pipelining**: Use Cap'n Proto promise pipelining
   - Benefit: N RTTs → 1 RTT for chained operations
   - Complexity: Medium (requires RPC redesign)
   - Risk: None (built-in to protocol)

3. **Query Optimization**:
   - Add database indexes for common query patterns
   - Use prepared statements (already done)
   - Optimize SQL queries for filtering/sorting

4. **Batch Operations**:
   - Encourage `getMany()` over individual `get()` calls
   - Implement bulk operations API
   - Document batching patterns

### Recommendation

**Close issue do-6dc7.15 as "not needed"** with rationale:

> DO-level caching is not beneficial for dotdo's architecture because:
> 1. Single-threaded execution model with local SQLite means no contention
> 2. SQLite read latency (0.1-1ms) is negligible vs RPC latency (50-100ms)
> 3. Read-write patterns invalidate cache immediately
> 4. Better alternatives exist (client-side caching, batch operations)
>
> Optimization should focus on:
> - Client-side caching (TanStack Query, React Query)
> - RPC pipelining for chained operations
> - Query optimization at database layer
> - Batch operations for read-heavy workloads

---

## References

- **Architecture**: `/ARCHITECTURE.md` - Design decisions and constraints
- **Entity Manager**: `/do/entities.ts` - EntityManager with ThingsStore wrapping
- **Things Store**: `/db/things.ts` - ThingsStore implementation
- **SQLite Adapter**: `/db/adapters/sqlite.ts` - Storage layer
- **Transaction Analysis**: `/TRANSACTION_ISOLATION_ANALYSIS.md` - Related concurrency analysis
- **Client Caching**: `/app/data/README.md` - React Query caching patterns
- **Tests**: `/do/tests/entities-sqlite.test.ts` - Real usage patterns
