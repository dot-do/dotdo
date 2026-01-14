# Unified Storage

A cost-optimized storage architecture for Cloudflare Durable Objects using the **Pipeline-as-WAL** pattern.

## Overview

Unified Storage dramatically reduces SQLite write costs (~95% reduction) by treating Cloudflare Pipeline as the Write-Ahead Log (WAL), enabling immediate durability with lazy local persistence.

### The Problem

Traditional DO storage: Every write = 1 SQLite operation = $$$

With high-frequency writes (IoT sensors, real-time collaboration, etc.), SQLite costs dominate.

### The Solution

```
┌─────────────────────────────────────────────────────────────────┐
│                        WRITE PATH                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Client                                                          │
│    │                                                             │
│    ▼                                                             │
│  UnifiedStoreDO                                                  │
│    │                                                             │
│    ├──► PipelineEmitter ──► Pipeline (WAL) ──► ACK to Client    │
│    │         │                                                   │
│    │         ▼                                                   │
│    └──► InMemoryStateManager                                     │
│              │                                                   │
│              ▼                                                   │
│         LazyCheckpointer ──► SQLite (batched, every N seconds)  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        READ PATH                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Client ──► InMemoryStateManager ──► Response (O(1))            │
│                                                                  │
│  SQLite is NEVER touched for reads!                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### InMemoryStateManager

Fast in-memory state with O(1) CRUD operations and dirty tracking.

```typescript
import { InMemoryStateManager } from './in-memory-state-manager'

const manager = new InMemoryStateManager({
  maxEntries: 10000,        // LRU eviction threshold
  maxBytes: 50 * 1024 * 1024, // 50MB memory limit
  onEvict: (entries) => console.log(`Evicted ${entries.length} entries`)
})

// Create
const customer = manager.create({ $type: 'Customer', name: 'Alice' })
// => { $id: 'customer_abc123', $type: 'Customer', $version: 1, name: 'Alice' }

// Read (O(1))
const retrieved = manager.get(customer.$id)

// Update (increments $version)
const updated = manager.update(customer.$id, { name: 'Alice Smith' })
// => { ..., $version: 2, name: 'Alice Smith' }

// Delete
manager.delete(customer.$id)

// Dirty tracking for checkpointing
const dirtyIds = manager.getDirtyEntries() // Set<string>
manager.markClean(Array.from(dirtyIds))
```

**Key Features:**
- O(1) Map-based lookups
- Automatic ID generation: `{type}_{uuid}`
- Version tracking (`$version` increments on update)
- LRU eviction (prefers clean entries over dirty)
- Memory usage estimation

### PipelineEmitter

Fire-and-forget event emission to Cloudflare Pipeline with batching and retry logic.

```typescript
import { PipelineEmitter } from './pipeline-emitter'

const emitter = new PipelineEmitter(env.EVENTS, {
  namespace: 'tenant-123',
  batchSize: 1000,            // Flush at 1000 events
  batchBytes: 1024 * 1024,    // Or at 1MB
  flushInterval: 60000,       // Or every 60s
  maxRetries: 3,              // Retry failed sends
  exponentialBackoff: true,   // 1s, 2s, 4s delays
  deadLetterQueue: env.DLQ,   // Failed events go here
})

// Fire-and-forget emit
emitter.emit('thing.created', 'things', { $id: 'customer_123', name: 'Alice' })

// Each event includes:
// - verb: 'thing.created'
// - store: 'things'
// - payload: { ... }
// - timestamp: ISO 8601
// - idempotencyKey: 'customer_123:created:1699123456789'
// - _meta: { namespace: 'tenant-123' }

// Explicit flush when needed
await emitter.flush()

// Cleanup
await emitter.close()
```

**Key Features:**
- Fire-and-forget semantics (non-blocking)
- Automatic batching (count, bytes, time)
- Idempotency keys for deduplication
- Retry with exponential backoff
- Dead-letter queue support

### LazyCheckpointer

Batched persistence to SQLite with configurable triggers.

```typescript
import { LazyCheckpointer } from './lazy-checkpointer'

const checkpointer = new LazyCheckpointer({
  sql: state.storage.sql,
  dirtyTracker: stateManagerAdapter,
  intervalMs: 10000,           // Timer checkpoint every 10s
  dirtyCountThreshold: 100,    // Or at 100 dirty entries
  memoryThresholdBytes: 10 * 1024 * 1024, // Or at 10MB dirty
  columnarThreshold: 50,       // Collections < 50 items → columnar
  onCheckpoint: (stats) => console.log(`Checkpointed ${stats.entityCount} entities`),
  onError: (err) => console.error('Checkpoint failed:', err)
})

// Start timer-based checkpoints
checkpointer.start()

// Notify when data becomes dirty (may trigger immediate checkpoint)
checkpointer.notifyDirty()

// Manual checkpoint
await checkpointer.checkpoint('manual')

// Before DO hibernation
await checkpointer.beforeHibernation()

// Get statistics
const stats = checkpointer.getStats()
// => { totalRowWrites: 42, columnarWrites: 5, normalizedWrites: 37 }

// Cleanup
await checkpointer.destroy()
```

**Columnar vs Normalized Storage:**

| Collection Size | Storage Format | Row Count |
|-----------------|----------------|-----------|
| < 50 items | Columnar (JSON blob) | 1 row |
| >= 50 items | Normalized (per-entity) | N rows |

This hybrid approach minimizes row writes for small collections while maintaining query efficiency for large ones.

### ColdStartRecovery

State restoration when a Durable Object starts cold.

```typescript
import { ColdStartRecovery } from './cold-start-recovery'

const recovery = new ColdStartRecovery({
  namespace: 'tenant-123',
  sql: state.storage.sql,
  iceberg: env.ICEBERG,        // Optional fallback
  timeout: 30000,              // 30s timeout
  onProgress: (progress) => {
    console.log(`${progress.phase}: ${progress.loaded}/${progress.total} (${progress.elapsedMs}ms)`)
  }
})

// Normal recovery (SQLite first, Iceberg fallback)
const result = await recovery.recover()
// => { source: 'sqlite', thingsLoaded: 1234, eventsReplayed: 0, durationMs: 87 }

// Force Iceberg rebuild (for corruption recovery)
const rebuilt = await recovery.forceRebuildFromIceberg()

// Access recovered state
const state = recovery.getState() // Map<string, Thing>

// Validate consistency
const validation = recovery.validateState()
if (!validation.valid) {
  console.error('State validation errors:', validation.errors)
}
```

**Recovery Strategy:**
1. Load from local SQLite (~100ms) - fast path
2. If SQLite empty/corrupted, replay from Iceberg (slower but complete)
3. Handle empty state gracefully

### UnifiedStoreDO

Main Durable Object class integrating all components.

```typescript
import { UnifiedStoreDO } from './unified-store-do'

export class MyDO {
  private store: UnifiedStoreDO

  constructor(state: DurableObjectState, env: Env) {
    this.store = new UnifiedStoreDO(state, env, {
      namespace: state.id.name ?? 'default',
      checkpointInterval: 5000,    // 5s checkpoint interval
      columnarThreshold: 1000,     // Columnar for < 1000 items
      dirtyCountThreshold: 100,    // Checkpoint at 100 dirty
      iceberg: env.ICEBERG,        // Optional Iceberg reader
    })
  }

  async fetch(request: Request): Promise<Response> {
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair())
      server.accept()

      server.addEventListener('message', async (event) => {
        const msg = JSON.parse(event.data as string)

        switch (msg.type) {
          case 'create':
            await this.store.handleCreate(server, msg)
            break
          case 'read':
            await this.store.handleRead(server, msg)
            break
          case 'update':
            await this.store.handleUpdate(server, msg)
            break
          case 'delete':
            await this.store.handleDelete(server, msg)
            break
          case 'batch':
            await this.store.handleBatch(server, msg)
            break
        }
      })

      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('WebSocket required', { status: 400 })
  }

  // Lifecycle hooks
  async onStart() {
    await this.store.onStart()
  }

  async beforeHibernation() {
    await this.store.beforeHibernation()
  }
}
```

## Cost Model

### Traditional Approach

```
1000 writes/second × 86400 seconds/day = 86.4M SQLite writes/day
```

### Unified Storage Approach

```
Pipeline writes: 1000/second (batched by Cloudflare, cheap)
SQLite writes: 1 batch/5 seconds = 17,280 writes/day

Reduction: 86.4M → 17,280 = 99.98% fewer SQLite operations
```

Even with a conservative checkpoint interval of 1 second:

```
Reduction: 86.4M → 86,400 = 99.9% fewer SQLite operations
```

### Why This Works

1. **Pipeline is the WAL**: Data is durable the moment it hits Pipeline
2. **Immediate ACK**: Clients get confirmation before SQLite
3. **Batched Persistence**: SQLite writes are grouped, not per-operation
4. **Cold Start Recovery**: Iceberg provides infinite retention backup

## Configuration Options

### UnifiedStoreConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `namespace` | `string` | DO ID | Tenant/namespace identifier |
| `checkpointInterval` | `number` | `5000` | ms between timer checkpoints |
| `columnarThreshold` | `number` | `1000` | Collection size for columnar storage |
| `dirtyCountThreshold` | `number` | `100` | Dirty entries before checkpoint |
| `iceberg` | `IcebergReader` | - | Optional Iceberg for recovery |

### PipelineEmitterConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `namespace` | `string` | **required** | Event namespace |
| `batchSize` | `number` | `1000` | Events before flush |
| `batchBytes` | `number` | `1MB` | Bytes before flush |
| `flushInterval` | `number` | `60000` | ms between flushes (0 = immediate) |
| `maxRetries` | `number` | `3` | Retry attempts |
| `retryDelay` | `number` | `1000` | Initial retry delay ms |
| `exponentialBackoff` | `boolean` | `false` | Double delay on each retry |
| `deadLetterQueue` | `Pipeline` | - | Failed event destination |

### LazyCheckpointerOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sql` | `SqlStorage` | **required** | SQLite storage |
| `dirtyTracker` | `DirtyTracker` | **required** | Dirty entry tracker |
| `intervalMs` | `number` | `10000` | Timer checkpoint interval |
| `dirtyCountThreshold` | `number` | `100` | Count threshold |
| `memoryThresholdBytes` | `number` | `10MB` | Memory threshold |
| `columnarThreshold` | `number` | `50` | Columnar vs normalized cutoff |
| `onCheckpoint` | `function` | - | Checkpoint callback |
| `onError` | `function` | - | Error callback |

## Data Flow Guarantees

### Durability

1. **Pipeline ACK = Durable**: Once Pipeline accepts, data survives DO eviction
2. **SQLite = Cache**: Local persistence is for fast cold start, not primary durability
3. **Iceberg = Archive**: Long-term storage and disaster recovery

### Consistency

1. **Writes**: Pipeline → Memory → SQLite (eventual)
2. **Reads**: Memory only (SQLite never touched)
3. **Cold Start**: SQLite → Iceberg fallback

### Ordering

1. **Within DO**: Total ordering via single-threaded execution
2. **Across DOs**: Events ordered by timestamp in Pipeline
3. **Recovery**: Events replayed in timestamp order from Iceberg

## Testing

```bash
# Run unified storage tests
npx vitest run objects/unified-storage/

# Run specific component tests
npx vitest run objects/unified-storage/in-memory-state-manager.test.ts
npx vitest run objects/unified-storage/pipeline-emitter.test.ts
npx vitest run objects/unified-storage/lazy-checkpointer.test.ts
npx vitest run objects/unified-storage/cold-start-recovery.test.ts
npx vitest run objects/unified-storage/unified-store-do.test.ts
```

## WebSocket Components

The Unified Storage architecture includes a complete WebSocket layer for real-time communication. WebSocket messages are **20:1 cheaper** than HTTP requests ($0.0075/M vs $0.15/M messages).

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    WEBSOCKET ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Client                                                          │
│    │                                                             │
│    ▼                                                             │
│  WSConnectionManager ◄── Handles upgrade, sessions, hibernation  │
│    │                                                             │
│    ▼                                                             │
│  WSOperationRouter ◄──── Routes messages to state manager        │
│    │                                                             │
│    ├──► InMemoryStateManager (CRUD operations)                   │
│    │                                                             │
│    ▼                                                             │
│  WSBroadcaster ◄──────── Fan-out updates to subscribers          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### WSProtocol

Message types and serialization for WebSocket communication.

```typescript
import { WSProtocol } from './ws-protocol'

// Create messages using factory methods
const createMsg = WSProtocol.createMessage('Customer', { name: 'Alice' })
const readMsg = WSProtocol.readMessage(['customer_123', 'customer_456'])
const updateMsg = WSProtocol.updateMessage('customer_123', { name: 'Alice Smith' })
const deleteMsg = WSProtocol.deleteMessage('customer_123')
const batchMsg = WSProtocol.batchMessage([createMsg, updateMsg])
const subscribeMsg = WSProtocol.subscribeMessage('Customer.*')

// Serialize/deserialize
const json = WSProtocol.serialize(createMsg)
const message = WSProtocol.deserialize(json)

// Type guards
if (WSProtocol.isCreateMessage(message)) {
  console.log('Creating:', message.$type)
}

// Create responses
const ack = WSProtocol.ackResponse('msg-123', { $id: 'customer_123', $version: 1 })
const error = WSProtocol.errorResponse('msg-123', 'NOT_FOUND', 'Entity not found')
```

**Message Types:**
- `create` - Create a new thing
- `read` - Read one or more things by ID
- `update` - Update an existing thing
- `delete` - Delete a thing
- `batch` - Group multiple operations
- `subscribe` - Subscribe to real-time updates
- `unsubscribe` - Cancel a subscription

**Response Types:**
- `ack` - Acknowledgement for mutations
- `read_response` - Data response for reads
- `error` - Error response with code and message
- `subscription_update` - Real-time update notification

### WSConnectionManager

Manages hibernatable WebSocket connections with session tracking.

```typescript
import { WSConnectionManager } from './ws-connection-manager'

const manager = new WSConnectionManager(ctx, {
  maxConnections: 10000,    // Connection limit
  pingInterval: 30000,      // Ping every 30s
  sessionTimeout: 300000,   // 5 minute timeout
})

// Handle WebSocket upgrade
const response = await manager.handleUpgrade(request, {
  userId: 'user_123',
  topics: ['orders', 'notifications']
})

// Broadcast to all connections
await manager.broadcast(JSON.stringify({ type: 'announcement', data: {} }))

// Broadcast to specific topic
await manager.broadcastToTopic('orders', JSON.stringify({ type: 'order.created' }))

// Manage subscriptions
manager.subscribe(sessionId, ['new-topic'])
manager.unsubscribe(sessionId, ['old-topic'])

// Get statistics
const stats = manager.getStats()
// => { totalConnections: 42, activeConnections: 42, topicCounts: { orders: 10 } }

// Hibernation support
const state = manager.getSerializableState()
await manager.restoreFromHibernation(state)
```

**Key Features:**
- Hibernatable connections (zero cost when idle)
- Session state management
- Topic-based subscriptions
- Connection limits with 503 responses
- Automatic ping/pong handling

### WSOperationRouter

Routes WebSocket messages to state manager operations.

```typescript
import { WSOperationRouter, ErrorCodes } from './ws-operation-router'

const router = new WSOperationRouter(stateManager, emitter)

// Handle incoming WebSocket message
ws.addEventListener('message', async (event) => {
  await router.handleMessageString(event.data, ws)
})

// Or handle parsed message directly
await router.handleMessage(parsedMessage, ws)
```

**Supported Operations:**
- `create` - Validates $type, creates entity, emits event, sends ACK
- `read` - Returns map of $id to thing (or null)
- `update` - Updates entity, emits event, sends ACK with new $version
- `delete` - Deletes entity, emits event, sends ACK
- `batch` - Executes multiple operations with optional atomic mode

**Error Codes:**
- `VALIDATION_ERROR` - Invalid message structure
- `NOT_FOUND` - Entity not found
- `PARSE_ERROR` - Invalid JSON
- `UNKNOWN_TYPE` - Unknown message type
- `INTERNAL_ERROR` - Unexpected error
- `BATCH_FAILED` - Atomic batch failed

### WSBroadcaster

Efficient fan-out of updates to subscribed WebSocket clients.

```typescript
import { WSBroadcaster } from './ws-broadcaster'

const broadcaster = new WSBroadcaster({
  eventStore: myEventStore,      // For backfill
  batchSize: 100,                // Batch fan-out
  yieldEvery: 10,                // Yield for fairness
  maxQueueSize: 100,             // Per-client queue
  dropPolicy: 'oldest',          // Drop oldest on overflow
  coalesceWindowMs: 100,         // Coalesce rapid updates
  maxCoalesceDelayMs: 1000,      // Max coalesce delay
})

// Subscribe client to type
const sub = broadcaster.subscribe(ws, { $type: 'Customer' })

// Subscribe to specific entity
broadcaster.subscribe(ws, { $id: 'customer_123' })

// Subscribe to all (wildcard)
broadcaster.subscribe(ws, { wildcard: true })

// Subscribe with options
broadcaster.subscribe(ws, {
  $type: 'Order',
  includePayload: true,          // Include full entity in messages
  backfill: true,                // Receive historical events
  backfillLimit: 100,            // Max backfill events
  coalesce: false,               // Disable coalescing for this sub
})

// Broadcast an event
await broadcaster.broadcast({
  type: 'thing.created',
  entityId: 'customer_123',
  entityType: 'Customer',
  payload: { $id: 'customer_123', $type: 'Customer', name: 'Alice' },
  ts: Date.now(),
  version: 1,
})

// Unsubscribe
broadcaster.unsubscribe(ws, sub.id)

// Handle disconnect
broadcaster.handleDisconnect(ws)

// Get statistics
const stats = broadcaster.getStats()
// => { totalSubscriptions: 50, totalClients: 10, totalBroadcasts: 1000 }

// Error handling
broadcaster.onError((client, error) => {
  console.error('Client error:', error)
})

// Cleanup
await broadcaster.close()
```

**Subscription Patterns:**
- `$type` - Subscribe to all entities of a type
- `$id` - Subscribe to a specific entity
- `wildcard` - Subscribe to all updates

**Backpressure Handling:**
- Per-client message queues
- Configurable queue size
- Drop policy (oldest/newest)
- Auto-disconnect on too many drops

**Message Coalescing:**
- Combines rapid updates within a window
- First message delivered immediately
- Subsequent updates coalesced
- Coalesced message includes count

## See Also

- [CLAUDE.md](../../CLAUDE.md) - Project overview
- [Pipeline Emitter Tests](./pipeline-emitter.test.ts) - Usage examples
- [DO Base](../DOBase.ts) - Base Durable Object class
- [WebSocket Protocol Spec](./docs/ws-protocol-spec.md) - Detailed protocol specification
- [WebSocket Integration Example](./examples/websocket-integration.ts) - Complete client example
