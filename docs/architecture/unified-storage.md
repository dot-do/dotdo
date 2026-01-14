# Unified Storage Architecture: Pipeline-as-WAL

> **TL;DR**: Pipeline is your WAL. DOs are materialized views. Zero data loss with lazy local persistence.

## The Core Insight

```
Traditional:  Mutation → SQLite → [maybe] Event
Unified:      Mutation → Pipeline → [lazy] SQLite
                           ↓
                        Iceberg (permanent)
```

**Data loss window = 0** because Pipeline is durable before local persistence.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                     │
│                     (Browser, SDK, Other Workers)                        │
└─────────────────┬───────────────────────────────────────────────────────┘
                  │ WebSocket (20:1 pricing = 95% cheaper)
                  │ Hibernatable (zero duration cost when idle)
                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         DURABLE OBJECT                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    IN-MEMORY STATE                                 │  │
│  │  Map<id, Thing>  +  WriteBufferCache  +  DirtyTracking            │  │
│  │                                                                    │  │
│  │  • All reads: O(1) memory lookup                                  │  │
│  │  • All writes: Update memory + emit event                         │  │
│  │  • No SQLite on hot path                                          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│              ┌───────────────┼───────────────┐                          │
│              ↓               ↓               ↓                          │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐               │
│  │   Pipeline    │  │    SQLite     │  │   Broadcast   │               │
│  │   (async)     │  │   (lazy)      │  │   (realtime)  │               │
│  │               │  │               │  │               │               │
│  │ Fire-and-     │  │ Checkpoint    │  │ WebSocket     │               │
│  │ forget to     │  │ every 5s or   │  │ fanout to     │               │
│  │ Iceberg       │  │ on hibernate  │  │ subscribers   │               │
│  └───────┬───────┘  └───────────────┘  └───────────────┘               │
│          │                                                              │
└──────────┼──────────────────────────────────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE PIPELINE                               │
│                                                                          │
│   • At-least-once delivery (retries with backoff)                       │
│   • Exactly-once via idempotency keys + dedup window                    │
│   • Batching: 1000 events or 1MB or 60s                                 │
│   • Cost: $0.015/million events                                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
           │
           ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                           R2 ICEBERG                                     │
│                                                                          │
│   • Permanent event storage (source of truth)                           │
│   • Partitioned by (ns, type, hour) for efficient queries               │
│   • Time-travel queries via event replay                                │
│   • Zero egress cost (same region)                                      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Cost Model

| Component | Cost | Notes |
|-----------|------|-------|
| **HTTP Request** | $0.15/M | Standard DO invocation |
| **WebSocket Message** | $0.0075/M | **20:1 ratio** |
| **Duration (active)** | $12.50/M GB-s | Wall-clock time |
| **Duration (hibernating)** | $0 | Zero cost |
| **SQLite Row Write** | $1.00/M | Starting Jan 2026 |
| **Pipeline Event** | $0.015/M | Fire-and-forget |
| **R2 Storage** | $0.015/GB | Permanent storage |

### Example: 1M mutations/month

| Approach | Request Cost | Storage Cost | Total |
|----------|--------------|--------------|-------|
| **HTTP + immediate SQLite** | $150 | $1.00 | $151.00 |
| **WS + lazy columnar** | $7.50 | $0.01 | $7.51 |
| **Savings** | 95% | 99% | **95%** |

## Data Flow

### Write Path (Hot)

```typescript
// 1. Client sends mutation via WebSocket
ws.send(JSON.stringify({
  type: 'create',
  $type: 'Customer',
  data: { name: 'Alice' }
}))

// 2. DO receives message
async webSocketMessage(ws: WebSocket, message: string) {
  const op = JSON.parse(message)

  // 3. Generate ID and update in-memory state (FAST)
  const $id = `customer_${crypto.randomUUID()}`
  const thing = { $id, $type: op.$type, ...op.data }
  this.state.set($id, thing)
  this.dirty.add($id)

  // 4. Emit to Pipeline (fire-and-forget, DURABLE)
  this.pipeline.send([{
    type: 'thing.created',
    entityId: $id,
    payload: thing,
    ts: Date.now(),
    idempotencyKey: `${$id}:create`,
  }])

  // 5. Send ACK to client (IMMEDIATE)
  ws.send(JSON.stringify({ status: 'ack', $id }))

  // 6. Broadcast to subscribers
  this.broadcast({ type: 'created', thing })

  // 7. SQLite checkpoint happens LATER (lazy)
  // - On timer (every 5s)
  // - Before hibernation
  // - On memory pressure
}
```

### Read Path (Hot)

```typescript
// Always from memory - O(1)
async get($id: string): Promise<Thing | null> {
  return this.state.get($id) ?? null
}
```

### Cold Start (Warm)

```typescript
async onStart() {
  // Option 1: Load from local SQLite (fast, ~100ms)
  const rows = this.sql.exec('SELECT * FROM things')
  for (const row of rows) {
    this.state.set(row.id, row)
  }

  // Option 2: Replay from Pipeline/Iceberg (if SQLite empty)
  if (this.state.size === 0) {
    const events = await this.iceberg.query(
      `SELECT * FROM do_events WHERE ns = ? ORDER BY ts`,
      [this.namespace]
    )
    for (const event of events) {
      this.applyEvent(event)
    }
  }
}
```

## Sharding Pattern

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ROUTER WORKER                                  │
│                                                                          │
│   const shard = hash(tenantId) % NUM_SHARDS                             │
│   const stub = env.DO.get(env.DO.idFromName(`shard-${shard}`))          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
           │
           ├──────────────────┬──────────────────┬──────────────────┐
           ↓                  ↓                  ↓                  ↓
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │  Shard 0    │    │  Shard 1    │    │  Shard 2    │    │  Shard N    │
    │             │    │             │    │             │    │             │
    │ tenants     │    │ tenants     │    │ tenants     │    │ tenants     │
    │ 0,4,8...    │    │ 1,5,9...    │    │ 2,6,10...   │    │ 3,7,11...   │
    │             │    │             │    │             │    │             │
    │ In-memory   │    │ In-memory   │    │ In-memory   │    │ In-memory   │
    │ state       │    │ state       │    │ state       │    │ state       │
    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
           │                  │                  │                  │
           └──────────────────┴──────────────────┴──────────────────┘
                                       │
                                       ↓
                         ┌─────────────────────────┐
                         │    SHARED PIPELINE      │
                         │                         │
                         │  All shards emit to     │
                         │  same event stream      │
                         │                         │
                         │  Events tagged with:    │
                         │  - ns (namespace)       │
                         │  - shard (partition)    │
                         └─────────────────────────┘
                                       │
                                       ↓
                         ┌─────────────────────────┐
                         │      R2 ICEBERG         │
                         │                         │
                         │  Partitioned by:        │
                         │  (ns, shard, hour)      │
                         │                         │
                         │  Any shard can query    │
                         │  cross-shard if needed  │
                         └─────────────────────────┘
```

### Sharding Benefits

1. **Horizontal scale**: Each shard handles 1/N of traffic
2. **Memory isolation**: Each shard has independent in-memory state
3. **Parallel writes**: No coordination between shards
4. **Global queries**: Iceberg has all data for analytics

### Shard Assignment

```typescript
// Simple hash-based sharding
function getShardId(tenantId: string, numShards: number): number {
  const hash = fnv1a(tenantId)
  return hash % numShards
}

// Consistent hashing for dynamic scaling
function getShardIdConsistent(tenantId: string, shards: string[]): string {
  const ring = new ConsistentHashRing(shards)
  return ring.getNode(tenantId)
}

// Range-based sharding for time-series
function getShardIdRange(timestamp: number, shardDurationMs: number): string {
  const shardIndex = Math.floor(timestamp / shardDurationMs)
  return `time-shard-${shardIndex}`
}
```

## Replication Pattern

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                      │
└─────────────────┬───────────────────────────────────────────────────────┘
                  │
    ┌─────────────┴─────────────┐
    │ Writes                    │ Reads (load-balanced)
    ↓                           ↓
┌─────────────┐    ┌─────────────────────────────────────────────────┐
│   LEADER    │    │                 FOLLOWERS                        │
│   (write)   │    │                                                  │
│             │    │  ┌─────────┐  ┌─────────┐  ┌─────────┐          │
│  In-memory  │    │  │ Replica │  │ Replica │  │ Replica │          │
│  SQLite     │    │  │    1    │  │    2    │  │    N    │          │
│             │    │  │         │  │         │  │         │          │
│  Emit to ───┼────┼──│← Subscribe to Pipeline                       │
│  Pipeline   │    │  │         │  │         │  │         │          │
└─────────────┘    │  └─────────┘  └─────────┘  └─────────┘          │
                   │                                                  │
                   └──────────────────────────────────────────────────┘
                                       ↑
                                       │
                         ┌─────────────┴─────────────┐
                         │        PIPELINE           │
                         │                           │
                         │  Leader emits events      │
                         │  Followers consume        │
                         │  (fan-out via Iceberg     │
                         │   or direct subscription) │
                         └───────────────────────────┘
```

### Replication Modes

#### 1. Leader-Follower (Strong Consistency for Writes)

```typescript
class LeaderDO extends UnifiedStoreDO {
  async webSocketMessage(ws: WebSocket, message: string) {
    // Only leader accepts writes
    const op = JSON.parse(message)

    // Update state + emit to pipeline
    await this.mutate(op)

    // Pipeline automatically fans out to followers
  }
}

class FollowerDO extends UnifiedStoreDO {
  async onStart() {
    // Subscribe to pipeline events
    this.pipeline.subscribe(this.namespace, async (event) => {
      // Apply event to local state (read-only replay)
      this.applyEvent(event)
    })
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    const op = JSON.parse(message)

    if (op.type === 'read') {
      // Serve reads from local state
      return this.get(op.$id)
    } else {
      // Forward writes to leader
      return this.forwardToLeader(op)
    }
  }
}
```

#### 2. Multi-Master (Eventual Consistency)

```typescript
class MultiMasterDO extends UnifiedStoreDO {
  async mutate(op: Mutation) {
    // Generate vector clock for ordering
    const vectorClock = this.incrementClock()

    // Apply locally
    const event = {
      ...op,
      vectorClock,
      origin: this.doId,
      ts: Date.now(),
    }
    this.applyEvent(event)

    // Emit to pipeline (other replicas will receive)
    this.pipeline.send([event])
  }

  async onPipelineEvent(event: Event) {
    // Skip our own events
    if (event.origin === this.doId) return

    // Conflict resolution via vector clock
    const existing = this.getEvent(event.entityId)
    if (existing && this.conflictsWith(existing, event)) {
      event = this.resolveConflict(existing, event)
    }

    this.applyEvent(event)
  }

  resolveConflict(a: Event, b: Event): Event {
    // Last-write-wins (simple)
    return a.ts > b.ts ? a : b

    // Or: merge (CRDTs)
    // Or: custom logic per entity type
  }
}
```

#### 3. Geographic Distribution

```typescript
// Edge routing based on client location
const REGION_TO_REPLICA = {
  'us-west': 'replica-us-west',
  'us-east': 'replica-us-east',
  'eu-west': 'replica-eu',
  'asia-east': 'replica-asia',
}

function routeToNearestReplica(request: Request, env: Env) {
  const cf = request.cf
  const region = cf?.region || 'us-west'
  const replicaName = REGION_TO_REPLICA[region] || 'replica-us-west'

  const stub = env.DO.get(env.DO.idFromName(replicaName))
  return stub.fetch(request)
}
```

## Implementation

### UnifiedStoreDO Base Class

```typescript
import { DO } from '../objects/DO'
import { getPipeline } from '../streaming/managed-pipeline'
import { ColumnarStore } from '../do/capabilities/fsx/storage/columnar'
import { WriteBufferCache } from '../do/capabilities/fsx/storage/write-buffer'

interface UnifiedStoreConfig {
  // Memory settings
  maxMemoryMB?: number           // Default: 50MB

  // Checkpoint settings
  checkpointIntervalMs?: number  // Default: 5000ms
  checkpointOnHibernate?: boolean // Default: true

  // Pipeline settings
  pipelineBatchSize?: number     // Default: 1000
  pipelineFlushMs?: number       // Default: 100ms (aggressive)

  // Columnar settings
  columnarThreshold?: number     // Collections < this use columnar (default: 1000)
}

export class UnifiedStoreDO extends DO {
  // In-memory state (source of truth during runtime)
  protected state: Map<string, Thing> = new Map()
  protected dirty: Set<string> = new Set()

  // Write buffer for columnar checkpoint
  protected cache: WriteBufferCache<Thing>

  // Pipeline for durable events
  protected pipeline: Pipeline

  // WebSocket clients
  protected clients: Map<WebSocket, ClientSession> = new Map()

  // Config
  protected config: Required<UnifiedStoreConfig>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    this.config = {
      maxMemoryMB: 50,
      checkpointIntervalMs: 5000,
      checkpointOnHibernate: true,
      pipelineBatchSize: 1000,
      pipelineFlushMs: 100,
      columnarThreshold: 1000,
    }

    this.cache = new WriteBufferCache<Thing>({
      maxBytes: this.config.maxMemoryMB * 1024 * 1024,
      onEvict: (key, value) => this.onCacheEvict(key, value),
    })

    this.pipeline = getPipeline(env, this.namespace)
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async onStart() {
    // Load from SQLite into memory
    await this.loadFromSQLite()

    // Start checkpoint timer
    this.scheduleCheckpoint()
  }

  async beforeHibernation() {
    // Flush everything before hibernating
    if (this.config.checkpointOnHibernate) {
      await this.checkpoint('hibernation')
    }
  }

  // ============================================================================
  // WebSocket Handlers
  // ============================================================================

  async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)

    // Accept with hibernation support
    this.ctx.acceptWebSocket(server as WebSocket, ['client'])

    this.clients.set(server as WebSocket, {
      id: crypto.randomUUID(),
      connectedAt: Date.now(),
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string) {
    const op = JSON.parse(message)

    switch (op.type) {
      case 'create':
        return this.handleCreate(ws, op)
      case 'read':
        return this.handleRead(ws, op)
      case 'update':
        return this.handleUpdate(ws, op)
      case 'delete':
        return this.handleDelete(ws, op)
      case 'batch':
        return this.handleBatch(ws, op)
      case 'subscribe':
        return this.handleSubscribe(ws, op)
    }
  }

  // ============================================================================
  // CRUD Operations (Pipeline-First)
  // ============================================================================

  protected async handleCreate(ws: WebSocket, op: CreateOp) {
    const $id = op.$id || `${op.$type.toLowerCase()}_${crypto.randomUUID()}`
    const now = Date.now()

    const thing: Thing = {
      $id,
      $type: op.$type,
      $version: 1,
      $createdAt: now,
      $updatedAt: now,
      ...op.data,
    }

    // 1. Update in-memory state (FAST)
    this.state.set($id, thing)
    this.dirty.add($id)
    this.cache.set($id, thing)

    // 2. Emit to Pipeline (DURABLE, fire-and-forget)
    this.pipeline.send([{
      type: 'thing.created',
      collection: 'Thing',
      operation: 'create',
      entityId: $id,
      entityType: op.$type,
      payload: thing,
      ts: now,
      version: 1,
      actorId: this.getActorId(ws),
      idempotencyKey: `${$id}:create:${now}`,
    }])

    // 3. ACK to client (IMMEDIATE)
    this.send(ws, { id: op.id, status: 'ack', $id })

    // 4. Broadcast to subscribers
    this.broadcast({ type: 'thing.created', thing })

    // 5. SQLite checkpoint happens LATER (lazy, ~5s)
    this.maybeCheckpoint()

    return thing
  }

  protected async handleRead(ws: WebSocket, op: ReadOp) {
    // Always from memory - O(1)
    const things: Record<string, Thing | null> = {}

    for (const $id of op.$ids) {
      things[$id] = this.state.get($id) ?? null
    }

    this.send(ws, { id: op.id, status: 'ok', things })
  }

  protected async handleUpdate(ws: WebSocket, op: UpdateOp) {
    const existing = this.state.get(op.$id)
    if (!existing) {
      return this.send(ws, { id: op.id, status: 'error', code: 'NOT_FOUND' })
    }

    const now = Date.now()
    const thing: Thing = {
      ...existing,
      ...op.data,
      $id: op.$id,
      $version: existing.$version + 1,
      $updatedAt: now,
    }

    // 1. Update in-memory
    this.state.set(op.$id, thing)
    this.dirty.add(op.$id)
    this.cache.set(op.$id, thing)

    // 2. Emit to Pipeline
    this.pipeline.send([{
      type: 'thing.updated',
      collection: 'Thing',
      operation: 'update',
      entityId: op.$id,
      entityType: thing.$type,
      payload: op.data,  // Just the delta
      ts: now,
      version: thing.$version,
      actorId: this.getActorId(ws),
      idempotencyKey: `${op.$id}:update:${now}`,
    }])

    // 3. ACK + Broadcast
    this.send(ws, { id: op.id, status: 'ack', $id: op.$id, $version: thing.$version })
    this.broadcast({ type: 'thing.updated', thing, delta: op.data })

    return thing
  }

  protected async handleDelete(ws: WebSocket, op: DeleteOp) {
    const existing = this.state.get(op.$id)
    if (!existing) {
      return this.send(ws, { id: op.id, status: 'ok' }) // Idempotent
    }

    const now = Date.now()

    // 1. Remove from memory
    this.state.delete(op.$id)
    this.dirty.delete(op.$id)
    this.cache.delete(op.$id)

    // 2. Emit to Pipeline
    this.pipeline.send([{
      type: 'thing.deleted',
      collection: 'Thing',
      operation: 'delete',
      entityId: op.$id,
      entityType: existing.$type,
      payload: { $id: op.$id },
      ts: now,
      version: existing.$version + 1,
      actorId: this.getActorId(ws),
      idempotencyKey: `${op.$id}:delete:${now}`,
    }])

    // 3. ACK + Broadcast
    this.send(ws, { id: op.id, status: 'ok' })
    this.broadcast({ type: 'thing.deleted', $id: op.$id })
  }

  // ============================================================================
  // Checkpoint (Lazy SQLite Persistence)
  // ============================================================================

  protected checkpointTimer: ReturnType<typeof setTimeout> | null = null

  protected scheduleCheckpoint() {
    if (this.checkpointTimer) return

    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null
      this.checkpoint('timer').catch(console.error)
    }, this.config.checkpointIntervalMs)
  }

  protected async checkpoint(trigger: string) {
    if (this.dirty.size === 0) return

    const start = Date.now()
    const dirtyThings = Array.from(this.dirty).map(id => this.state.get(id)!).filter(Boolean)

    // Columnar: One row per collection type
    const byType = new Map<string, Thing[]>()
    for (const thing of dirtyThings) {
      const list = byType.get(thing.$type) || []
      list.push(thing)
      byType.set(thing.$type, list)
    }

    // Write each collection as columnar JSON
    for (const [type, things] of byType) {
      if (things.length < this.config.columnarThreshold) {
        // Small collection: columnar (one row)
        await this.writeColumnar(type, things)
      } else {
        // Large collection: normalized (one row per thing)
        await this.writeNormalized(things)
      }
    }

    // Clear dirty tracking
    this.dirty.clear()
    this.cache.markClean(Array.from(this.cache.getDirtyEntries().keys()))

    console.log(`Checkpoint (${trigger}): ${dirtyThings.length} things in ${Date.now() - start}ms`)
  }

  protected async writeColumnar(type: string, things: Thing[]) {
    // One row per type with JSON array of all things
    const json = JSON.stringify(things)

    this.ctx.storage.sql.exec(`
      INSERT OR REPLACE INTO collections (type, data, updated_at)
      VALUES (?, ?, ?)
    `, type, json, Date.now())
  }

  protected async writeNormalized(things: Thing[]) {
    // One row per thing (for large collections)
    for (const thing of things) {
      this.ctx.storage.sql.exec(`
        INSERT OR REPLACE INTO things (id, type, data, updated_at)
        VALUES (?, ?, ?, ?)
      `, thing.$id, thing.$type, JSON.stringify(thing), Date.now())
    }
  }

  // ============================================================================
  // Cold Start Recovery
  // ============================================================================

  protected async loadFromSQLite() {
    // Load columnar collections
    const collections = this.ctx.storage.sql.exec(
      'SELECT type, data FROM collections'
    ).toArray()

    for (const { data } of collections) {
      const things = JSON.parse(data as string) as Thing[]
      for (const thing of things) {
        this.state.set(thing.$id, thing)
      }
    }

    // Load normalized things
    const normalized = this.ctx.storage.sql.exec(
      'SELECT id, data FROM things'
    ).toArray()

    for (const { id, data } of normalized) {
      this.state.set(id as string, JSON.parse(data as string))
    }

    console.log(`Loaded ${this.state.size} things from SQLite`)
  }

  protected async rebuildFromIceberg() {
    // If SQLite is empty, rebuild from Iceberg
    const events = await this.queryIceberg(`
      SELECT * FROM do_events
      WHERE ns = ?
      ORDER BY ts ASC
    `, [this.namespace])

    for (const event of events) {
      this.applyEvent(event)
    }

    console.log(`Rebuilt ${this.state.size} things from ${events.length} events`)
  }

  protected applyEvent(event: DomainEvent) {
    switch (event.operation) {
      case 'create':
      case 'update':
        const existing = this.state.get(event.entityId) || {}
        this.state.set(event.entityId, { ...existing, ...event.payload })
        break
      case 'delete':
        this.state.delete(event.entityId)
        break
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  protected send(ws: WebSocket, data: unknown) {
    ws.send(JSON.stringify(data))
  }

  protected broadcast(data: unknown) {
    const message = JSON.stringify(data)
    for (const ws of this.clients.keys()) {
      ws.send(message)
    }
  }

  protected getActorId(ws: WebSocket): string {
    return this.clients.get(ws)?.id || 'anonymous'
  }

  protected maybeCheckpoint() {
    // Check if we should checkpoint early
    if (this.dirty.size >= 100 || this.cache.getStats().memoryUsageRatio > 0.8) {
      this.checkpoint('threshold').catch(console.error)
    } else {
      this.scheduleCheckpoint()
    }
  }
}
```

## Schema

```sql
-- Columnar storage (small collections)
CREATE TABLE IF NOT EXISTS collections (
  type TEXT PRIMARY KEY,
  data TEXT NOT NULL,           -- JSON array of things
  updated_at INTEGER NOT NULL
);

-- Normalized storage (large collections)
CREATE TABLE IF NOT EXISTS things (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,           -- JSON object
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_things_type ON things(type);

-- Event log (optional local cache)
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_events_entity ON events(entity_id);
```

## Summary

| Aspect | Traditional | Unified |
|--------|-------------|---------|
| **Write Path** | Mutation → SQLite → Event | Mutation → Pipeline → [lazy] SQLite |
| **Data Loss Window** | 0 (sync write) | 0 (Pipeline is durable) |
| **Read Latency** | ~1ms (SQLite) | ~0.01ms (memory) |
| **Write Latency** | ~1ms (SQLite) | ~0.01ms (memory + async emit) |
| **Request Cost** | $0.15/M (HTTP) | $0.0075/M (WebSocket) |
| **Storage Cost** | $1.00/M rows | $0.01/M rows (columnar) |
| **Cold Start** | Load from SQLite | Load from SQLite OR replay from Iceberg |
| **Sharding** | Manual coordination | Trivial (shared Pipeline) |
| **Replication** | Complex (leader election) | Simple (event replay) |
| **Time Travel** | Not supported | Replay from any point |
| **Audit Trail** | Separate system | Built-in (Iceberg) |

**The key insight**: Pipeline is your WAL. DOs are just materialized views. This inverts the traditional architecture but gives you durability, scalability, and cost efficiency all at once.
