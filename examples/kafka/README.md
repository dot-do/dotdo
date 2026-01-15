# kafka.example.com.ai

Kafka-compatible streaming on dotdo. No clusters. No Zookeeper. No ops.

## The Problem

You have Kafka code that works. You also have Zookeeper to manage, broker rebalancing at 3am, and a DevOps team just for Kafka.

## The Solution

Point your Kafka client at dotdo. Keep your code. Drop the infrastructure.

```
Your Kafka Code  -->  kafka.example.com.ai  -->  Durable Objects
                      (speaks Kafka protocol)    (zero ops)
```

## Quick Start

```typescript
import { Kafka } from 'kafkajs'

const kafka = new Kafka({
  brokers: ['kafka.example.com.ai'],
  ssl: true,
})

const producer = kafka.producer()
await producer.connect()

await producer.send({
  topic: 'orders',
  messages: [{ key: 'order-123', value: JSON.stringify({ amount: 99.99 }) }],
})
```

## Creating Topics

```typescript
const admin = kafka.admin()
await admin.connect()

await admin.createTopics({
  topics: [{ topic: 'events', numPartitions: 16 }],
})
```

Topics become Things. Partitions become shards. Each partition maps to a DO.

## Producing Messages

```typescript
// Single message
await producer.send({
  topic: 'events',
  messages: [{ key: 'user-123', value: JSON.stringify({ action: 'click' }) }],
})

// Batch (efficient - single round trip)
await producer.send({
  topic: 'events',
  messages: [
    { key: 'user-123', value: JSON.stringify({ action: 'click' }) },
    { key: 'user-456', value: JSON.stringify({ action: 'purchase' }) },
  ],
})
```

Messages flow through Pipeline (WAL) for durability before SQLite checkpoint.

## Consuming Messages

```typescript
const consumer = kafka.consumer({ groupId: 'analytics-service' })
await consumer.connect()
await consumer.subscribe({ topic: 'events', fromBeginning: true })

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    console.log({
      partition,
      key: message.key?.toString(),
      value: message.value?.toString(),
      offset: message.offset,
    })
  },
})
```

Consumer groups coordinate via a dedicated DO. No Zookeeper required.

## Offset Management

```typescript
// Auto-commit (default)
const consumer = kafka.consumer({ groupId: 'my-service' })

// Manual commit
const consumer = kafka.consumer({ groupId: 'my-service', autoCommit: false })

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    await processMessage(message)
    await consumer.commitOffsets([
      { topic, partition, offset: (BigInt(message.offset) + 1n).toString() },
    ])
  },
})
```

## Architecture

```
                         kafka.example.com.ai
                        (Kafka Protocol Worker)
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        v                         v                         v
 ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
 │ Partition 0 │          │ Partition 1 │          │ Partition N │
 │     DO      │          │     DO      │          │     DO      │
 └─────────────┘          └─────────────┘          └─────────────┘
        │                         │                         │
        └─────────────────────────┼─────────────────────────┘
                                  v
                           ┌─────────────┐
                           │  Pipeline   │
                           │   (WAL)     │
                           └─────────────┘
```

Each partition DO has: in-memory buffer (L0), Pipeline for durability (L1), lazy SQLite checkpoint (L2).

## Kafka vs dotdo

| Feature | Kafka | dotdo |
|---------|-------|-------|
| Partition storage | Broker disk | DO SQLite + Pipeline |
| Replication | Multi-broker | Cloudflare edge |
| Consumer groups | Zookeeper/KRaft | DO coordination |
| Ops overhead | High | Zero |
| Cost | Clusters 24/7 | Pay per request |

## Migrate Your First Topic

1. Create topic:

```typescript
await admin.createTopics({ topics: [{ topic: 'events', numPartitions: 16 }] })
```

2. Update broker config:

```typescript
const kafka = new Kafka({
  brokers: ['kafka.example.com.ai'], // was: ['kafka-1:9092', 'kafka-2:9092']
  ssl: true,
})
```

3. Deploy. Producers and consumers work unchanged.

## Limitations

- Max message size: 1MB (Cloudflare limit)
- Transactions: Not supported (use `$.do()` for durable workflows)
- Exactly-once: Idempotency keys handle deduplication

## See Also

- [dotdo v2 README](/README.md) - Architecture overview
- [Storage module](/storage) - Pipeline-as-WAL
- [Streaming module](/streaming) - WebSocket and pub/sub
