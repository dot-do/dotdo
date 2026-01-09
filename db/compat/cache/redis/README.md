# redis.do

**Redis for Cloudflare Workers.** ioredis-compatible. Edge-native. Durable by default.

[![npm version](https://img.shields.io/npm/v/@dotdo/redis.svg)](https://www.npmjs.com/package/@dotdo/redis)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why redis.do?

**Your existing Redis code.** The ioredis and node-redis APIs you already know. No rewrites.

**No external connections.** Traditional Redis requires TCP connections, which Workers don't support. redis.do runs entirely on DO storage - no connection pools, no latency to external servers.

**Scales to millions of agents.** Each agent gets isolated Redis-like storage backed by Durable Objects. No noisy neighbors. No shared state. Just fast, durable key-value operations at global scale.

```typescript
import { Redis } from '@dotdo/redis'

const redis = new Redis()

// String commands
await redis.set('user:123', 'Alice')
await redis.get('user:123') // 'Alice'

// Hash commands
await redis.hset('session:abc', { userId: '123', role: 'admin' })
await redis.hgetall('session:abc') // { userId: '123', role: 'admin' }

// Sorted sets for leaderboards
await redis.zadd('leaderboard', 100, 'player1', 200, 'player2')
await redis.zrevrange('leaderboard', 0, 9) // Top 10 players
```

## Installation

```bash
npm install @dotdo/redis
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                          │
│                                                              │
│   const redis = new Redis()                                  │
│   await redis.set('key', 'value')                           │
│   await redis.hset('hash', { field: 'value' })              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    @dotdo/redis                              │
│                                                              │
│   ioredis-compatible API layer                              │
│   Command parsing and type coercion                         │
│   Pipeline/transaction batching                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 Durable Object SQLite                        │
│                                                              │
│   Strings → KV table with TTL                               │
│   Hashes  → Hash table with field storage                   │
│   Lists   → Ordered list table with indexes                 │
│   Sets    → Unique member table                             │
│   ZSets   → Scored member table with B-tree index           │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### ioredis-style Constructor

```typescript
import { Redis } from '@dotdo/redis'

// Default options
const redis = new Redis()

// With options
const redis = new Redis({
  keyPrefix: 'myapp:',
  db: 0,
})

// URL-style (parsed but uses DO storage)
const redis = new Redis('redis://localhost:6379')
```

### node-redis-style Factory

```typescript
import { createClient } from '@dotdo/redis'

const client = createClient()
await client.set('key', 'value')
```

## Command Reference

### String Commands

| Command | Description | Example |
|---------|-------------|---------|
| `GET` | Get value | `await redis.get('key')` |
| `SET` | Set value | `await redis.set('key', 'value')` |
| `MGET` | Get multiple | `await redis.mget('k1', 'k2')` |
| `MSET` | Set multiple | `await redis.mset('k1', 'v1', 'k2', 'v2')` |
| `INCR` | Increment | `await redis.incr('counter')` |
| `DECR` | Decrement | `await redis.decr('counter')` |
| `INCRBY` | Increment by N | `await redis.incrby('counter', 5)` |
| `APPEND` | Append string | `await redis.append('key', ' world')` |
| `STRLEN` | String length | `await redis.strlen('key')` |
| `SETNX` | Set if not exists | `await redis.setnx('key', 'value')` |
| `SETEX` | Set with expiry | `await redis.setex('key', 60, 'value')` |
| `GETSET` | Get and set | `await redis.getset('key', 'new')` |
| `GETDEL` | Get and delete | `await redis.getdel('key')` |

### SET Options

```typescript
// Expiry options
await redis.set('key', 'value', { EX: 60 })      // Expire in 60 seconds
await redis.set('key', 'value', { PX: 60000 })   // Expire in 60000 ms
await redis.set('key', 'value', { EXAT: ts })    // Expire at Unix timestamp
await redis.set('key', 'value', { KEEPTTL: true }) // Keep existing TTL

// Conditional options
await redis.set('key', 'value', { NX: true })    // Only if not exists
await redis.set('key', 'value', { XX: true })    // Only if exists

// Return old value
await redis.set('key', 'new', { GET: true })     // Returns old value
```

### Hash Commands

| Command | Description | Example |
|---------|-------------|---------|
| `HGET` | Get field | `await redis.hget('hash', 'field')` |
| `HSET` | Set field(s) | `await redis.hset('hash', 'f', 'v')` |
| `HMGET` | Get multiple fields | `await redis.hmget('hash', 'f1', 'f2')` |
| `HMSET` | Set multiple fields | `await redis.hmset('hash', { f1: 'v1' })` |
| `HGETALL` | Get all fields | `await redis.hgetall('hash')` |
| `HDEL` | Delete fields | `await redis.hdel('hash', 'f1', 'f2')` |
| `HEXISTS` | Check field exists | `await redis.hexists('hash', 'field')` |
| `HKEYS` | Get all field names | `await redis.hkeys('hash')` |
| `HVALS` | Get all values | `await redis.hvals('hash')` |
| `HLEN` | Get field count | `await redis.hlen('hash')` |
| `HINCRBY` | Increment field | `await redis.hincrby('hash', 'count', 1)` |
| `HSETNX` | Set if not exists | `await redis.hsetnx('hash', 'f', 'v')` |

### List Commands

| Command | Description | Example |
|---------|-------------|---------|
| `LPUSH` | Push to head | `await redis.lpush('list', 'a', 'b')` |
| `RPUSH` | Push to tail | `await redis.rpush('list', 'a', 'b')` |
| `LPOP` | Pop from head | `await redis.lpop('list')` |
| `RPOP` | Pop from tail | `await redis.rpop('list')` |
| `LRANGE` | Get range | `await redis.lrange('list', 0, -1)` |
| `LLEN` | Get length | `await redis.llen('list')` |
| `LINDEX` | Get by index | `await redis.lindex('list', 0)` |
| `LSET` | Set by index | `await redis.lset('list', 0, 'val')` |
| `LREM` | Remove by value | `await redis.lrem('list', 2, 'val')` |
| `LTRIM` | Trim to range | `await redis.ltrim('list', 0, 99)` |
| `LINSERT` | Insert relative | `await redis.linsert('l', 'BEFORE', 'b', 'a')` |
| `LPOS` | Find position | `await redis.lpos('list', 'val')` |

### Set Commands

| Command | Description | Example |
|---------|-------------|---------|
| `SADD` | Add members | `await redis.sadd('set', 'a', 'b')` |
| `SREM` | Remove members | `await redis.srem('set', 'a')` |
| `SMEMBERS` | Get all members | `await redis.smembers('set')` |
| `SISMEMBER` | Check membership | `await redis.sismember('set', 'a')` |
| `SCARD` | Get cardinality | `await redis.scard('set')` |
| `SINTER` | Intersection | `await redis.sinter('s1', 's2')` |
| `SUNION` | Union | `await redis.sunion('s1', 's2')` |
| `SDIFF` | Difference | `await redis.sdiff('s1', 's2')` |
| `SRANDMEMBER` | Random member | `await redis.srandmember('set')` |
| `SPOP` | Pop random | `await redis.spop('set')` |
| `SMOVE` | Move member | `await redis.smove('src', 'dst', 'm')` |

### Sorted Set Commands

| Command | Description | Example |
|---------|-------------|---------|
| `ZADD` | Add with score | `await redis.zadd('zset', 100, 'a')` |
| `ZREM` | Remove members | `await redis.zrem('zset', 'a')` |
| `ZRANGE` | Get by index range | `await redis.zrange('zset', 0, -1)` |
| `ZREVRANGE` | Get reversed | `await redis.zrevrange('zset', 0, 9)` |
| `ZSCORE` | Get score | `await redis.zscore('zset', 'a')` |
| `ZRANK` | Get rank | `await redis.zrank('zset', 'a')` |
| `ZREVRANK` | Get reverse rank | `await redis.zrevrank('zset', 'a')` |
| `ZCARD` | Get cardinality | `await redis.zcard('zset')` |
| `ZCOUNT` | Count in range | `await redis.zcount('zset', 0, 100)` |
| `ZINCRBY` | Increment score | `await redis.zincrby('zset', 10, 'a')` |
| `ZRANGEBYSCORE` | Get by score | `await redis.zrangebyscore('z', 0, 100)` |
| `ZPOPMIN` | Pop minimum | `await redis.zpopmin('zset')` |
| `ZPOPMAX` | Pop maximum | `await redis.zpopmax('zset')` |

### ZADD Options

```typescript
// Conditional updates
await redis.zadd('zset', { NX: true }, 100, 'a')  // Only add new
await redis.zadd('zset', { XX: true }, 100, 'a')  // Only update existing
await redis.zadd('zset', { GT: true }, 100, 'a')  // Only if new > current
await redis.zadd('zset', { LT: true }, 100, 'a')  // Only if new < current

// Return options
await redis.zadd('zset', { CH: true }, 100, 'a')  // Return changed count
await redis.zadd('zset', { INCR: true }, 10, 'a') // Increment and return
```

### Key Commands

| Command | Description | Example |
|---------|-------------|---------|
| `DEL` | Delete keys | `await redis.del('k1', 'k2')` |
| `EXISTS` | Check existence | `await redis.exists('k1', 'k2')` |
| `EXPIRE` | Set TTL (seconds) | `await redis.expire('key', 60)` |
| `EXPIREAT` | Set expiry timestamp | `await redis.expireat('key', ts)` |
| `PEXPIRE` | Set TTL (ms) | `await redis.pexpire('key', 60000)` |
| `TTL` | Get TTL (seconds) | `await redis.ttl('key')` |
| `PTTL` | Get TTL (ms) | `await redis.pttl('key')` |
| `PERSIST` | Remove expiry | `await redis.persist('key')` |
| `KEYS` | Find by pattern | `await redis.keys('user:*')` |
| `SCAN` | Iterate keys | `await redis.scan(0, { MATCH: '*' })` |
| `TYPE` | Get key type | `await redis.type('key')` |
| `RENAME` | Rename key | `await redis.rename('old', 'new')` |
| `COPY` | Copy key | `await redis.copy('src', 'dst')` |
| `UNLINK` | Async delete | `await redis.unlink('key')` |

### Pub/Sub

```typescript
// Publisher
const pub = new Redis()
await pub.publish('channel', 'message')

// Subscriber
const sub = new Redis()
sub.on('message', (channel, message) => {
  console.log(`${channel}: ${message}`)
})
await sub.subscribe('channel')

// Pattern subscription
sub.on('pmessage', (pattern, channel, message) => {
  console.log(`[${pattern}] ${channel}: ${message}`)
})
await sub.psubscribe('user:*')
```

### Transactions (MULTI/EXEC)

```typescript
// Atomic transaction
const results = await redis
  .multi()
  .set('key1', 'value1')
  .set('key2', 'value2')
  .incr('counter')
  .exec()

// results = [[null, 'OK'], [null, 'OK'], [null, 1]]

// Optimistic locking with WATCH
await redis.watch('balance')
const balance = parseInt(await redis.get('balance') || '0')

const results = await redis
  .multi()
  .set('balance', balance - 100)
  .exec()

if (results === null) {
  // Another client modified 'balance' - retry
}
```

### Pipelines

```typescript
// Batch commands without transaction semantics
const results = await redis
  .pipeline()
  .set('key1', 'value1')
  .get('key1')
  .incr('counter')
  .exec()

// Each result is [error, value]
// results = [[null, 'OK'], [null, 'value1'], [null, 1]]
```

## Common Patterns

### Caching

```typescript
async function getUser(id: string) {
  // Check cache
  const cached = await redis.get(`user:${id}`)
  if (cached) return JSON.parse(cached)

  // Fetch from database
  const user = await db.users.find(id)

  // Cache for 1 hour
  await redis.set(`user:${id}`, JSON.stringify(user), { EX: 3600 })

  return user
}
```

### Session Storage

```typescript
async function createSession(userId: string) {
  const sessionId = crypto.randomUUID()

  await redis.hmset(`sess:${sessionId}`, {
    userId,
    createdAt: Date.now().toString(),
  })

  await redis.expire(`sess:${sessionId}`, 86400) // 24 hours

  return sessionId
}

async function getSession(sessionId: string) {
  return redis.hgetall(`sess:${sessionId}`)
}
```

### Rate Limiting

```typescript
async function checkRateLimit(userId: string): Promise<boolean> {
  const key = `rate:${userId}`
  const limit = 100
  const window = 60

  const count = await redis.incr(key)

  if (count === 1) {
    await redis.expire(key, window)
  }

  return count <= limit
}
```

### Leaderboards

```typescript
async function updateScore(playerId: string, score: number) {
  await redis.zadd('leaderboard', score, playerId)
}

async function getTopPlayers(count: number = 10) {
  return redis.zrevrange('leaderboard', 0, count - 1, 'WITHSCORES')
}

async function getPlayerRank(playerId: string) {
  return redis.zrevrank('leaderboard', playerId)
}
```

### Distributed Locks

```typescript
async function acquireLock(resource: string, ttl: number = 10) {
  const lockId = crypto.randomUUID()
  const key = `lock:${resource}`

  const acquired = await redis.set(key, lockId, { NX: true, EX: ttl })

  return acquired ? lockId : null
}

async function releaseLock(resource: string, lockId: string) {
  const key = `lock:${resource}`
  const current = await redis.get(key)

  if (current === lockId) {
    await redis.del(key)
    return true
  }
  return false
}
```

## Durable Object Integration

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withRedis } from '@dotdo/redis/do'

class GameSession extends withRedis(DO) {
  async addPlayer(playerId: string) {
    await this.redis.sadd('players', playerId)
    await this.redis.zadd('scores', 0, playerId)
  }

  async updateScore(playerId: string, points: number) {
    await this.redis.zincrby('scores', points, playerId)
  }

  async getLeaderboard() {
    return this.redis.zrevrange('scores', 0, -1, 'WITHSCORES')
  }
}
```

### Extended Options

```typescript
import { Redis } from '@dotdo/redis'

const redis = new Redis({
  // DO namespace binding (when using external DO)
  doNamespace: env.REDIS_DO,

  // Sharding configuration
  shard: {
    algorithm: 'consistent',
    count: 16,
  },

  // Replica configuration
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
    jurisdiction: 'eu',
  },

  // Storage backend hints
  storage: {
    preferKV: true,      // Use KV for simple strings
    preferSQLite: true,  // Use SQLite for complex types
  },
})
```

## Comparison

| Feature | Traditional Redis | redis.do |
|---------|------------------|----------|
| Connection | TCP (not in Workers) | None needed |
| Durability | Optional persistence | Always durable |
| Latency | Network round-trip | Local DO access |
| Scaling | Cluster setup | Automatic sharding |
| Edge deployment | Limited | 300+ cities |
| Cold starts | N/A | 0ms |
| Per-agent isolation | Manual | Automatic |

## Performance

- **<1ms** for single key operations
- **<5ms** for pipeline execution
- **Zero network latency** - storage is local to DO
- **No connection pooling** overhead
- **Automatic batching** in pipelines

## Limitations

- No Lua scripting (use transactions instead)
- No cluster commands (sharding is automatic)
- No blocking commands (BLPOP, etc.)
- No streams (use Pub/Sub or queues)

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://redis.do)
- [dotdo](https://dotdo.dev)
- [Platform.do](https://platform.do)
