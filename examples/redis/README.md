# redis.example.com.ai

Redis-compatible cache and pub/sub at the edge. Use your existing Redis client library with dotdo's L0 in-memory store and WebSocket streaming.

## The Problem

Redis needs a server. Cluster mode is complex. Managed Redis adds latency and cost.

## The Solution

dotdo speaks Redis wire protocol and runs on Cloudflare's edge. Your Redis client connects to `redis.example.com.ai` and gets sub-millisecond latency worldwide.

```
┌─────────────┐     Redis Protocol     ┌─────────────┐
│ Redis Client│ ───────────────────── │ dotdo DO    │
│ (ioredis)   │                        │ L0: InMemory│
└─────────────┘                        └─────────────┘
```

## Quick Start

### 1. Connect with any Redis client

```typescript
import Redis from 'ioredis'

const redis = new Redis({
  host: 'redis.example.com.ai',
  port: 443,
  tls: {},
})
```

### 2. Cache your first key

```typescript
await redis.set('user:123', JSON.stringify({ name: 'Alice' }))
const user = await redis.get('user:123')
```

## Commands

### GET / SET / DEL

Basic key-value operations backed by L0 InMemory store:

```typescript
// SET with optional expiration
await redis.set('session:abc', 'data')
await redis.set('session:abc', 'data', 'EX', 3600)  // 1 hour TTL
await redis.set('session:abc', 'data', 'PX', 60000) // 60s in milliseconds

// GET
const value = await redis.get('session:abc')

// DEL
await redis.del('session:abc')
await redis.del('key1', 'key2', 'key3') // Multiple keys
```

### TTL Support

Keys can expire automatically:

```typescript
// Set with TTL
await redis.setex('cache:result', 300, 'computed-value') // 5 minutes
await redis.psetex('cache:result', 5000, 'value')        // 5 seconds

// Check TTL
const remaining = await redis.ttl('cache:result')  // Seconds
const remainingMs = await redis.pttl('cache:result') // Milliseconds

// Remove expiration
await redis.persist('cache:result')

// Set expiration on existing key
await redis.expire('cache:result', 600)
await redis.expireat('cache:result', Math.floor(Date.now() / 1000) + 600)
```

### MGET / MSET

Batch operations:

```typescript
// Set multiple keys
await redis.mset('k1', 'v1', 'k2', 'v2', 'k3', 'v3')

// Get multiple keys
const values = await redis.mget('k1', 'k2', 'k3')
// ['v1', 'v2', 'v3']
```

### INCR / DECR

Atomic counters:

```typescript
await redis.set('counter', '10')
await redis.incr('counter')      // 11
await redis.incrby('counter', 5) // 16
await redis.decr('counter')      // 15
await redis.decrby('counter', 3) // 12
```

### EXISTS / KEYS

Key inspection:

```typescript
const exists = await redis.exists('user:123') // 1 or 0

// Pattern matching (use sparingly)
const keys = await redis.keys('user:*')
```

## Pub/Sub

Real-time messaging via WebSocket transport:

### Subscribe

```typescript
const subscriber = new Redis({
  host: 'redis.example.com.ai',
  port: 443,
  tls: {},
})

subscriber.subscribe('notifications', 'alerts')

subscriber.on('message', (channel, message) => {
  console.log(`${channel}: ${message}`)
})
```

### Pattern Subscribe

```typescript
subscriber.psubscribe('events:*')

subscriber.on('pmessage', (pattern, channel, message) => {
  console.log(`${pattern} matched ${channel}: ${message}`)
})
```

### Publish

```typescript
const publisher = new Redis({
  host: 'redis.example.com.ai',
  port: 443,
  tls: {},
})

await publisher.publish('notifications', JSON.stringify({
  type: 'new_message',
  from: 'user:456',
}))
```

## Architecture

### Storage Stack

```
L0: InMemory    O(1) reads, dirty tracking, TTL
L1: Pipeline    WAL for durability (async)
L2: SQLite      Checkpoint on eviction
L3: Iceberg     Cold storage (optional)
```

### Write Path

```
SET key value
    │
    ▼
InMemoryStateManager.create()  ─── ACK to client
    │
    ▼ (async)
PipelineEmitter.emit()
    │
    ▼ (lazy batch)
SQLite checkpoint
```

### Pub/Sub Transport

```
PUBLISH channel message
    │
    ▼
SubscriptionManager.publish()
    │
    ▼
WebSocket broadcast to subscribers
```

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// ❌ Sequential - N round-trips
for (const key of keys) {
  await $.Cache(ns).invalidate(key)
}

// ✅ Pipelined - fire and forget
keys.forEach(key => $.Cache(ns).invalidate(key))

// ✅ Pipelined - single await at the end
const results = await Promise.all(
  keys.map(key => $.Cache(ns).get(key))
)
```

Fire-and-forget is valid for side effects like cache invalidation. Only `await` at exit points when you need the value. This maps directly to Redis pipelining - batch commands, reduce round-trips.

## TTL Implementation

TTL is tracked in the L0 store with lazy expiration:

```typescript
// Internal representation
interface CacheEntry {
  data: unknown
  expiresAt?: number  // Unix timestamp
}

// Expiration checked on read
get(key) {
  const entry = this.store.get(key)
  if (entry?.expiresAt && Date.now() > entry.expiresAt) {
    this.store.delete(key)
    return null
  }
  return entry?.data
}
```

## Deployment

### wrangler.toml

```toml
name = "redis-example"
main = "src/index.ts"

[[durable_objects.bindings]]
name = "REDIS"
class_name = "RedisDO"

[durable_objects]
[[durable_objects.classes]]
name = "RedisDO"
```

### Worker Entry

```typescript
import { RedisDO } from './redis-do'

export { RedisDO }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.REDIS.idFromName('default')
    const stub = env.REDIS.get(id)
    return stub.fetch(request)
  }
}
```

## Limitations

- Single DO namespace (no clustering)
- L0 memory limits apply (~128MB)
- No Lua scripting
- No transactions (MULTI/EXEC)
- No sorted sets, streams, or other advanced data structures

## When to Use

Use `redis.example.com.ai` for:

- Session caching
- Rate limiting
- Real-time notifications
- Feature flags
- Temporary data with TTL

Use managed Redis for:

- Large datasets (> 128MB)
- Complex data structures
- Lua scripting requirements
- Multi-region replication

## Related

- [dotdo v2 README](/README.md)
- [InMemoryStateManager](/storage/in-memory-state-manager.ts)
- [SubscriptionManager](/streaming/index.ts)
