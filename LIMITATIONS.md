# dotdo Limitations and Constraints

This document outlines the key limitations and constraints of dotdo, which runs on Cloudflare Workers and Durable Objects. Understanding these limits helps you design applications that work within the platform's boundaries.

---

## Cloudflare Workers Limits

### CPU Time Limits

| Plan | CPU Time Limit |
|------|----------------|
| Free | 10ms per request |
| Paid | 30ms per request (can be extended) |
| Unbound | 30 seconds per request |

**What counts as CPU time:**
- JavaScript/TypeScript execution
- NOT waiting for I/O (fetch, storage operations, etc.)

**Workarounds:**
- Use `$.do()` with durability to break long operations into retryable chunks
- Offload heavy computation to external services
- Use streaming responses for large data transfers

### Memory Limits

| Limit | Value |
|-------|-------|
| Memory per isolate | 128 MB |

**Workarounds:**
- Stream large files instead of loading into memory
- Use R2 for storing large objects
- Process data in chunks rather than all at once

### Request/Response Limits

| Limit | Value |
|-------|-------|
| Request body size | 100 MB (200 MB for Enterprise) |
| Response body size | Streaming (no hard limit) |
| Subrequest limit | 1000 per request (50 for Free) |
| Concurrent connections | 6 per host |

---

## Durable Object (DO) Limits

### SQLite Storage

| Limit | Value |
|-------|-------|
| **Storage per DO** | **10 GB** |
| Rows per table | Unlimited (within 10GB) |
| Key size | 2 KB |
| Value size | 128 KB per key-value pair |

**Design implications:**
- Each DO (tenant namespace) has its own 10GB SQLite database
- Large tenants may need sharding across multiple DOs
- Binary data should be stored in R2, not SQLite

### Alarm Scheduling

| Limit | Value |
|-------|-------|
| Alarms per DO | 1 active at a time |
| Minimum alarm delay | 0 seconds |
| Maximum alarm delay | ~30 days |

**Workarounds:**
- Chain alarms for recurring tasks (dotdo's `$.every.*` does this automatically)
- Use a scheduler DO to manage multiple timers

### WebSocket Limits

| Limit | Value |
|-------|-------|
| WebSocket connections per DO | Platform dependent |
| WebSocket attachment size | 2048 bytes |
| Message size | 1 MB |
| Hibernation timeout | Unlimited (with Hibernation API) |

**Best practices:**
- Use WebSocket Hibernation for cost savings (95%+ reduction on idle connections)
- Keep attachment data minimal (<2KB JSON-serializable)
- Implement reconnection protocol for session resumption

### Concurrent Request Handling

| Limit | Value |
|-------|-------|
| Concurrent requests per DO | Single-threaded (serialized) |
| Request queue depth | ~100 requests |

**Design implications:**
- DOs provide strong consistency via single-threaded execution
- Long-running requests block others - keep handlers fast
- Use sharding for high-throughput scenarios

---

## dotdo-Specific Considerations

### Event Buffer Limits

```typescript
// Default event replay buffer for WebSocket reconnection
const DEFAULT_MAX_EVENT_BUFFER = 1000
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
```

Events older than 30 minutes or beyond 1000 buffered events cannot be replayed.

### Rate Limiting

dotdo provides a rate limiting pattern in the ARCHITECTURE.md:

```typescript
// Example: 100 requests per minute per IP
if (count >= 100) {
  return new Response('Rate limit exceeded', { status: 429 })
}
```

Implement your own rate limiting based on your needs.

### Circuit Breaker Defaults

| Parameter | Default Value |
|-----------|---------------|
| Failure threshold | 5 failures |
| Reset timeout | 30 seconds |
| Success threshold | 3 successes |
| Request timeout | 10 seconds |
| Half-open ratio | 10% of requests |

---

## What NOT to Build with dotdo

Some use cases are fundamentally incompatible with the Workers/DO model:

### Avoid Building

1. **CPU-intensive compute jobs**
   - Image/video processing
   - ML model inference (large models)
   - Cryptographic mining
   - Complex scientific simulations

2. **Long-running processes**
   - Background jobs >30 seconds
   - Persistent daemon processes
   - Real-time game servers with complex physics

3. **High-throughput write workloads to a single entity**
   - >1000 writes/second to a single DO
   - Use sharding for high write volumes

4. **Large binary storage in SQLite**
   - Media files, documents, backups
   - Use R2 for blob storage instead

5. **Traditional relational database workloads**
   - Complex multi-table JOINs across tenants
   - OLAP analytics on large datasets

### Better Alternatives

| Use Case | Instead of dotdo, Use |
|----------|----------------------|
| Heavy compute | Modal, Replicate, dedicated servers |
| Large file storage | Cloudflare R2, S3 |
| Analytics/OLAP | ClickHouse, BigQuery, Snowflake |
| Real-time gaming | Dedicated game servers, Agones |
| ML inference | Cloudflare Workers AI, Replicate |
| Long background jobs | Temporal, AWS Step Functions |

---

## Workarounds for Common Limits

### Exceeding 10GB Storage Limit

Use **tiered storage** architecture:

```
Tier 1: DO SQLite (Hot)     - 10GB, <1ms access
Tier 2: R2 Iceberg (Warm)   - Unlimited, ~100ms access
Tier 3: ClickHouse (Cold)   - Unlimited, ~1s access
```

Or use **sharding**:

```typescript
const router = new ShardRouter({
  defaultShardCount: 16,
  entityShards: {
    'users': 32,      // Users across 32 DOs
    'orders': 64,     // Orders across 64 DOs
  }
})
```

### Handling High Concurrency

1. **Enable load balancing across shards:**
   ```typescript
   const router = new LoadBalancedRouter({
     strategy: 'least-loaded',
     defaultShardCount: 16,
   })
   ```

2. **Use health-aware routing:**
   ```typescript
   const router = new HealthAwareRouter({
     skipUnhealthyShards: true,
     preferHealthierShards: true,
   })
   ```

### Surviving DO Unavailability

Use the **circuit breaker pattern**:

```typescript
const breaker = new CircuitBreaker({
  name: 'customer-do',
  failureThreshold: 5,
  resetTimeoutMs: 30000,
})

const result = await breaker.execute(
  () => stub.fetch(request),
  () => cachedFallbackResponse()
)
```

### Reducing WebSocket Costs

Enable **hibernation** for idle connections:

```typescript
const manager = new HibernationManager(state, {
  enableAutoResponse: true,  // Respond to pings without waking DO
})
```

Savings: 95%+ reduction in compute costs for idle WebSocket connections.

---

## Monitoring and Observability

### Health Monitoring

Track shard health with built-in metrics:

```typescript
const monitor = new ShardHealthMonitor({
  latencyDegradedThreshold: 500,    // ms
  latencyUnhealthyThreshold: 2000,  // ms
  errorRateDegradedThreshold: 0.05, // 5%
  errorRateUnhealthyThreshold: 0.2, // 20%
  storageDegradedThreshold: 0.7,    // 70% full
  storageUnhealthyThreshold: 0.9,   // 90% full
})
```

### Key Metrics to Track

- Storage usage per DO (warn at 7GB, alert at 9GB)
- Request latency P95
- Error rates per tenant
- WebSocket connection count
- Alarm scheduling delays

---

## Summary

| Resource | Limit | Mitigation |
|----------|-------|------------|
| SQLite storage | 10 GB per DO | Sharding, tiered storage |
| CPU time | 30ms (extendable) | Chunk operations, durability |
| Memory | 128 MB | Streaming, R2 for blobs |
| Request body | 100 MB | Streaming uploads |
| Concurrent requests | Single-threaded | Sharding, load balancing |
| WebSocket message | 1 MB | Chunking, compression |
| WebSocket attachment | 2 KB | Keep minimal, JSON-only |

For the latest Cloudflare limits, see: https://developers.cloudflare.com/workers/platform/limits/

---

## Related Documentation

- [CLAUDE.md](./CLAUDE.md) - Development guidelines
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [Cloudflare DO Docs](https://developers.cloudflare.com/durable-objects/)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
