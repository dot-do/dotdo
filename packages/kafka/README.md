# @dotdo/kafka

Kafka-compatible message queue with in-memory backend for edge environments.

## Installation

```bash
npm install @dotdo/kafka
```

## Usage

### Basic Example

```typescript
import { createKafka } from '@dotdo/kafka'

// Create Kafka client
const kafka = createKafka({ brokers: ['localhost:9092'] })

// Create admin and topics
const admin = kafka.admin()
await admin.connect()
await admin.createTopics({
  topics: [{ topic: 'orders', numPartitions: 3 }]
})

// Create producer
const producer = kafka.producer()
await producer.connect()
await producer.send({
  topic: 'orders',
  messages: [
    { key: 'order-123', value: JSON.stringify({ product: 'Widget' }) }
  ]
})

// Create consumer
const consumer = kafka.consumer({ groupId: 'order-processor' })
await consumer.connect()
await consumer.subscribe({ topics: ['orders'], fromBeginning: true })

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    console.log(`Received: ${message.value?.toString()}`)
  }
})
```

### Producer API

```typescript
const producer = kafka.producer()
await producer.connect()

// Send single message
await producer.send({
  topic: 'my-topic',
  messages: [
    { key: 'key1', value: 'value1' },
    { key: 'key2', value: 'value2' },
  ]
})

// Send batch to multiple topics
await producer.sendBatch({
  topicMessages: [
    { topic: 'topic1', messages: [{ value: 'msg1' }] },
    { topic: 'topic2', messages: [{ value: 'msg2' }] },
  ]
})

await producer.disconnect()
```

### Consumer API

```typescript
const consumer = kafka.consumer({ groupId: 'my-group' })
await consumer.connect()

// Subscribe to topics
await consumer.subscribe({
  topics: ['my-topic'],
  fromBeginning: true
})

// Process messages one at a time
await consumer.run({
  eachMessage: async ({ topic, partition, message, heartbeat }) => {
    console.log(message.value?.toString())
    await heartbeat() // Keep session alive
  }
})

// Or process in batches
await consumer.run({
  eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
    for (const message of batch.messages) {
      console.log(message.value?.toString())
      resolveOffset(message.offset)
    }
    await heartbeat()
  }
})

// Manual offset commits
await consumer.commitOffsets([
  { topic: 'my-topic', partition: 0, offset: '100' }
])

// Seek to specific offset
consumer.seek({ topic: 'my-topic', partition: 0, offset: '50' })

// Pause/resume consumption
consumer.pause([{ topic: 'my-topic', partitions: [0, 1] }])
consumer.resume([{ topic: 'my-topic', partitions: [0, 1] }])

await consumer.stop()
await consumer.disconnect()
```

### Admin API

```typescript
const admin = kafka.admin()
await admin.connect()

// Create topics
await admin.createTopics({
  topics: [
    { topic: 'topic1', numPartitions: 3 },
    { topic: 'topic2', numPartitions: 1 },
  ]
})

// List topics
const topics = await admin.listTopics()

// Delete topics
await admin.deleteTopics({ topics: ['topic1'] })

// Fetch topic metadata
const metadata = await admin.fetchTopicMetadata({ topics: ['topic1'] })

// Manage consumer group offsets
const offsets = await admin.fetchOffsets({
  groupId: 'my-group',
  topics: ['my-topic']
})

await admin.resetOffsets({
  groupId: 'my-group',
  topic: 'my-topic',
  earliest: true
})

await admin.disconnect()
```

### Standalone Factory Functions

You can also use standalone factory functions:

```typescript
import { createAdmin, createProducer, createConsumer } from '@dotdo/kafka'

const admin = createAdmin()
await admin.connect()
// ...

const producer = createProducer({ admin })
await producer.connect()
// ...

const consumer = createConsumer({ admin, groupId: 'my-group' })
await consumer.connect()
// ...
```

## Features

- **KafkaJS-compatible API**: Drop-in replacement for KafkaJS in test environments
- **In-memory backend**: No external dependencies required
- **Key-based partitioning**: Messages with the same key go to the same partition
- **Consumer groups**: Full support for consumer group coordination
- **Offset management**: Auto-commit and manual offset commits
- **Seek operations**: Seek to specific offsets, beginning, or end
- **Pause/Resume**: Pause and resume partition consumption

## Testing

The in-memory backend is perfect for testing:

```typescript
import { resetRegistry } from '@dotdo/kafka'

beforeEach(() => {
  resetRegistry() // Clear all state between tests
})
```

## License

MIT
