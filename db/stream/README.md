# Stream Primitives

> Kafka-inspired streaming with topics, partitions, and consumer groups

## Overview

Stream primitives provide Kafka-compatible streaming semantics on top of DO SQLite and Cloudflare Pipelines. They enable event-driven architectures with exactly-once processing, consumer groups, and automatic offset management.

## Features

- **Topics** - Named event streams with configurable partitions
- **Partitions** - Parallel processing with ordering guarantees
- **Consumer groups** - Coordinated consumption with rebalancing
- **Exactly-once** - Idempotent processing with checkpointing
- **Backpressure** - Flow control for slow consumers
- **Three-tier storage** - Hot/warm/cold automatic tiering

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite                                                  │
│ • Recent messages (last 1 hour / 10,000 messages)               │
│ • Consumer offsets and group state                              │
│ • In-flight message tracking                                    │
│ Access: <1ms                                                    │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Parquet                                                │
│ • Older messages partitioned by time                            │
│ • Compacted topics (latest value per key)                       │
│ • Replay from any offset                                        │
│ Access: ~50ms                                                   │
├─────────────────────────────────────────────────────────────────┤
│ COLD: Pipeline → R2 Iceberg                                     │
│ • Full message history                                          │
│ • Cross-DO stream joins via R2 SQL                              │
│ • Compliance and audit                                          │
│ Access: ~100ms                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Topic

```typescript
import { Topic } from 'dotdo/db/stream'

const orders = new Topic<OrderEvent>('orders', {
  partitions: 8,
  retention: '7d',
  compaction: false,  // Keep all messages
})

// Produce message
await orders.produce({
  key: 'order_123',  // Determines partition
  value: { customerId: 'cust_1', total: 99.99 },
  headers: { source: 'checkout' },
})

// Produce batch
await orders.produceBatch([
  { key: 'order_124', value: { ... } },
  { key: 'order_125', value: { ... } },
])
```

### Consumer

```typescript
import { Consumer } from 'dotdo/db/stream'

const consumer = new Consumer('orders', {
  groupId: 'order-processor',
  autoCommit: true,
  autoCommitInterval: 5000,
})

// Subscribe to topic
await consumer.subscribe('orders')

// Consume messages
for await (const message of consumer) {
  await processOrder(message.value)
  // Auto-commit on next iteration
}

// Or manual commit
for await (const message of consumer) {
  await processOrder(message.value)
  await consumer.commit(message.offset)
}
```

### Consumer Group

```typescript
import { ConsumerGroup } from 'dotdo/db/stream'

const group = new ConsumerGroup('order-processor', {
  topics: ['orders'],
  rebalanceStrategy: 'range',  // or 'roundRobin'
})

// Group coordinates partition assignment
// Consumer 1 gets partitions 0-3
// Consumer 2 gets partitions 4-7

// Handle rebalance
group.on('rebalance', (assignment) => {
  console.log('Assigned partitions:', assignment)
})
```

## API

```typescript
import { Stream, Producer, Consumer, AdminClient } from 'dotdo/db/stream'

// Admin operations
const admin = new AdminClient()

await admin.createTopic('events', {
  partitions: 4,
  replicationFactor: 1,  // DO-local only
  config: {
    'retention.ms': 7 * 24 * 60 * 60 * 1000,
    'cleanup.policy': 'delete',  // or 'compact'
  }
})

await admin.listTopics()
await admin.describeTopic('events')
await admin.deleteTopic('events')

// Producer with partitioner
const producer = new Producer({
  partitioner: 'murmur2',  // Kafka-compatible
  compression: 'gzip',
  batchSize: 100,
  lingerMs: 10,
})

await producer.send('events', {
  key: 'user_123',
  value: { action: 'login', timestamp: Date.now() },
})

// Consumer with seek
const consumer = new Consumer('events', { groupId: 'analytics' })

await consumer.seekToBeginning()  // Replay from start
await consumer.seekToEnd()        // Skip to latest
await consumer.seek({ partition: 0, offset: 1000 })  // Specific offset
```

## Exactly-Once Semantics

```typescript
import { ExactlyOnceContext } from 'dotdo/do/primitives'

const ctx = new ExactlyOnceContext(db)

// Transactional produce
await ctx.transaction(async (tx) => {
  // Read from input topic
  const message = await inputConsumer.poll()

  // Process
  const result = await processMessage(message)

  // Write to output topic (part of transaction)
  await tx.produce('output', { key: message.key, value: result })

  // Commit input offset (part of transaction)
  await tx.commit(message.offset)
})
// Either all succeed or all rollback
```

## Compacted Topics

```typescript
// Compacted topic keeps only latest value per key
const userProfiles = new Topic<UserProfile>('user-profiles', {
  compaction: true,
  minCleanableDirtyRatio: 0.5,
})

// Multiple updates to same key
await userProfiles.produce({ key: 'user_1', value: { name: 'Alice' } })
await userProfiles.produce({ key: 'user_1', value: { name: 'Alice Smith' } })

// After compaction, only latest value retained
// Useful for: user profiles, config, entity state
```

## Schema

```sql
-- Messages table (hot tier)
CREATE TABLE stream_messages (
  topic TEXT NOT NULL,
  partition INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  key TEXT,
  value JSON NOT NULL,
  headers JSON,
  timestamp INTEGER NOT NULL,
  PRIMARY KEY (topic, partition, offset)
);

-- Consumer offsets
CREATE TABLE stream_offsets (
  group_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  partition INTEGER NOT NULL,
  offset INTEGER NOT NULL,
  metadata TEXT,
  committed_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, topic, partition)
);

-- Consumer group state
CREATE TABLE stream_groups (
  group_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  leader TEXT,
  members JSON,
  assignment JSON,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_topic ON stream_messages(topic, partition, timestamp);
```

## CDC Events

```typescript
// On produce
{
  type: 'stream.produce',
  topic: 'orders',
  partition: 3,
  offset: 12345,
  key: 'order_123',
  timestamp: '2024-01-14T12:00:00Z'
}

// On commit
{
  type: 'stream.commit',
  groupId: 'order-processor',
  topic: 'orders',
  partition: 3,
  offset: 12345
}
```

## When to Use

| Use Stream | Use Workflow |
|------------|--------------|
| Event-driven processing | Long-running processes |
| Fan-out to multiple consumers | Sequential activities |
| Log aggregation | Human-in-the-loop |
| Real-time analytics | Saga orchestration |

## Dependencies

None for core. Uses Cloudflare Pipelines for cold tier.

## Related

- [`streaming/`](../../streaming/) - Pipeline infrastructure
- [`do/primitives/exactly-once-context.ts`](../../do/primitives/exactly-once-context.ts) - Exactly-once processing
- Kafka protocol documentation for compatibility details

## Implementation Status

| Feature | Status |
|---------|--------|
| Topic CRUD | TBD |
| Producer | TBD |
| Consumer | TBD |
| Consumer groups | TBD |
| Exactly-once | See `do/primitives/exactly-once-context.ts` |
| Compaction | TBD |
| Hot → Warm tiering | TBD |
| Pipeline integration | TBD |
