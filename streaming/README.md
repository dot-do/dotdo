# streaming

**Event streaming for Cloudflare.** Kafka/NATS APIs. Pipelines backend. Iceberg storage.

## Why streaming?

**Workers don't have Kafka.** No persistent queues. No consumer groups. No replay.

**AI agents need coordination.** Events between agents. Audit logs. Analytics pipelines.

**streaming gives you both:**

```typescript
import { Kafka } from '@dotdo/kafka'

const kafka = new Kafka({ clientId: 'my-agent' })
const producer = kafka.producer()

await producer.send({
  topic: 'orders',
  messages: [{ key: 'order-123', value: JSON.stringify(order) }]
})
```

Same API. Backed by Cloudflare Pipelines ($0.015/million events) and R2 storage.

## Installation

```bash
npm install @dotdo/kafka @dotdo/nats @dotdo/sqs
```

## Quick Start

### Kafka API

```typescript
import { Kafka } from '@dotdo/kafka'

const kafka = new Kafka({ clientId: 'my-app' })

// Produce
const producer = kafka.producer()
await producer.send({
  topic: 'events',
  messages: [
    { key: 'user-1', value: JSON.stringify({ action: 'signup' }) }
  ]
})

// Consume
const consumer = kafka.consumer({ groupId: 'processor' })
await consumer.subscribe({ topics: ['events'] })
await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    console.log(message.value.toString())
  }
})
```

### NATS API

```typescript
import { connect } from '@dotdo/nats'

const nc = await connect()

// Publish
nc.publish('orders.new', JSON.stringify(order))

// Subscribe with wildcards
nc.subscribe('orders.*', {
  callback: (err, msg) => {
    console.log(msg.subject, msg.data)
  }
})

// JetStream for persistence
const js = nc.jetstream()
await js.publish('orders', JSON.stringify(order))

const consumer = await js.consumers.get('orders', 'processor')
const messages = await consumer.fetch({ max_messages: 10 })
```

### Real-Time WebSocket

```typescript
// Sub-second latency via EventStreamDO
const ws = new WebSocket('wss://stream.example.com.ai/events?topic=orders')

ws.onmessage = (event) => {
  const order = JSON.parse(event.data)
  console.log('New order:', order)
}
```

## Features

### Dual Path Architecture

Events go to both real-time subscribers and durable storage:

```
Producer
    │
    ├──────────────────┬────────────────────┐
    │                  │                    │
    ▼                  ▼                    │
EventStreamDO      Pipeline                 │
(real-time)        (batch)                  │
    │                  │                    │
    │                  ▼                    │
    │              R2 Parquet               │
    │              (Iceberg)                │
    │                  │                    │
    └──────────────────┴────────────────────┘
                       │
                       ▼
                  Unified Query
                  (hot + cold)
```

### Consumer Groups

Kafka-style partition assignment:

```typescript
// Multiple consumers share the load
const consumer1 = kafka.consumer({ groupId: 'workers' })
const consumer2 = kafka.consumer({ groupId: 'workers' })

// Automatic rebalancing
// Offsets tracked in Durable Objects
// Exactly-once via Iceberg snapshots
```

### SQL Queries

Query events like a database:

```typescript
const events = await stream.query(`
  SELECT * FROM orders
  WHERE timestamp > NOW() - INTERVAL '1 hour'
    AND status = 'completed'
  ORDER BY timestamp DESC
  LIMIT 100
`)
```

Automatically checks hot tier (last 5 minutes) then cold tier (Iceberg).

### Pipeline Transforms

Pre-aggregate in the pipeline:

```sql
-- transforms/aggregate.sql
SELECT
  DATE_TRUNC('minute', timestamp) AS minute,
  COUNT(*) AS count,
  SUM(amount) AS total,
  AVG(amount) AS avg
FROM __input__
GROUP BY minute
```

1M raw events → 1K aggregated rows. 1000x storage reduction.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Compat Layer                            │
├───────────────┬───────────────┬───────────────┬─────────────────┤
│ @dotdo/kafka  │ @dotdo/nats   │ @dotdo/sqs    │ @dotdo/pubsub   │
│ kafkajs API   │ nats.js API   │ AWS SDK v3    │ GCP API         │
└───────┬───────┴───────┬───────┴───────┬───────┴────────┬────────┘
        │               │               │                │
        └───────────────┴───────────────┴────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────┐
│      EventStreamDO        │   │      Cloudflare Pipelines     │
│                           │   │                               │
│  • PGLite (hot events)    │   │  • $0.015/million events     │
│  • WebSocket broadcast    │   │  • Batch: 1MB or 60s         │
│  • Live queries           │   │  • SQL transforms            │
│  • 5-minute retention     │   │  • Auto-partition            │
│  • <10ms latency          │   │                               │
└─────────────┬─────────────┘   └───────────────┬───────────────┘
              │                                 │
              └─────────────┬───────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FSX Tiered Storage                           │
│  ┌─────────────┐  ┌─────────────────┐  ┌───────────────────┐   │
│  │ Hot         │  │ Warm            │  │ Cold              │   │
│  │ DO SQLite   │  │ R2 + Iceberg    │  │ R2 Archive        │   │
│  │ Last 5 min  │  │ Parquet files   │  │ Compliance        │   │
│  └─────────────┘  └─────────────────┘  └───────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      R2 Data Catalog                            │
│  • Managed Iceberg metadata                                     │
│  • External access: Spark, Snowflake, DuckDB                   │
│  • Zero egress                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### Pipeline

```toml
# wrangler.toml

[[pipelines]]
name = "events"
batch = { max_bytes = 1048576, max_seconds = 60 }
destination = {
  type = "r2",
  bucket = "events-lake",
  format = "parquet",
  table_format = "iceberg"
}
partition_by = ["topic", "_partition_hour"]
```

### StreamBridge

```typescript
import { StreamBridge } from '@dotdo/streaming'

const stream = new StreamBridge(env.PIPELINE, {
  sink: 'iceberg',
  batchSize: 1000,
  flushInterval: 60_000,
  transform: (event) => ({
    ...event,
    _partition_hour: getHour(event.timestamp)
  })
})

stream.emit('insert', 'orders', orderData)
await stream.flush()
```

## Compat SDKs

### @dotdo/kafka

Full kafkajs compatibility:

| Class | Methods |
|-------|---------|
| `Kafka` | `producer()`, `consumer()`, `admin()` |
| `Producer` | `send()`, `sendBatch()`, `transaction()` |
| `Consumer` | `subscribe()`, `run()`, `poll()`, `commit()` |
| `Admin` | `createTopics()`, `deleteTopics()`, `listTopics()` |

### @dotdo/nats

Full nats.js compatibility:

| Feature | Support |
|---------|---------|
| Core pub/sub | ✅ |
| Subject wildcards | ✅ (`*`, `>`) |
| Request/reply | ✅ |
| JetStream | ✅ |
| KV store | ✅ |
| Headers | ✅ |

### @dotdo/sqs

AWS SDK v3 compatible:

| Method | Support |
|--------|---------|
| `sendMessage` | ✅ |
| `receiveMessage` | ✅ |
| `deleteMessage` | ✅ |
| `createQueue` | ✅ |
| `deleteQueue` | ✅ |
| Batch operations | ✅ |

## CDC Integration

Database changes → Event stream:

```typescript
// Enable CDC on edge-postgres table
await db.enableCDC('orders')

// Subscribe to changes
const consumer = kafka.consumer({ groupId: 'sync' })
await consumer.subscribe({ topics: ['cdc.orders'] })

// Receive INSERT/UPDATE/DELETE events
await consumer.run({
  eachMessage: async ({ message }) => {
    const change = JSON.parse(message.value)
    // { operation: 'INSERT', table: 'orders', new: {...} }
  }
})
```

## API Reference

### StreamBridge

| Method | Description |
|--------|-------------|
| `emit(op, table, data)` | Emit event (buffered) |
| `flush()` | Force flush to pipeline |
| `close()` | Cleanup |

### UnifiedStream

| Method | Description |
|--------|-------------|
| `query(sql, params)` | Query hot + cold tiers |
| `subscribe(topic, handler)` | Real-time subscription |
| `emit(event)` | Send to both paths |

### EventStreamDO

| Method | Description |
|--------|-------------|
| `broadcast(event)` | Send to subscribers |
| `query(sql, params)` | Query hot events |
| `handleWebSocket(ws)` | Accept subscription |

## Comparison

| Feature | Kafka | Pipelines + R2 |
|---------|-------|----------------|
| Ingestion cost | $0.10-0.20/GB | $0.015/M events |
| Storage cost | $0.10/GB/mo | $0.015/GB/mo |
| Egress cost | $0.05-0.12/GB | $0 |
| Ops required | Yes | No |
| Cold start | Seconds | 0ms |
| Consumer groups | ✅ | ✅ |
| Exactly-once | ✅ | ✅ (Iceberg) |
| SQL queries | ksqlDB ($$$) | Built-in |

## Related

- [edge-postgres](/db/edge-postgres) - Database layer
- [Iceberg](/db/iceberg) - Table format
- [FSX](/db/fsx) - Tiered storage
- [StreamBridge](/streaming/core) - Core implementation
