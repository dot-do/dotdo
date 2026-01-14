# @dotdo/sqs

**AWS SQS for Cloudflare Workers.** Edge-native message queues. Durable Object-backed. Zero dependencies.

[![npm version](https://img.shields.io/npm/v/@dotdo/sqs.svg)](https://www.npmjs.com/package/@dotdo/sqs)
[![Tests](https://img.shields.io/badge/tests-14%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why @dotdo/sqs?

**Edge workers can't use AWS SQS directly.** The official SDK requires AWS credentials exposed at runtime and network round-trips to AWS data centers.

**AI agents need message queues.** They need reliable job processing, task distribution, and async workflows with at-least-once delivery.

**@dotdo/sqs gives you both:**

```typescript
import { SQSClient, SendMessageCommand, ReceiveMessageCommand } from '@dotdo/sqs'

// Drop-in replacement - same API, runs on the edge
const client = new SQSClient({ region: 'us-east-1' })

// Send messages
await client.send(new SendMessageCommand({
  QueueUrl,
  MessageBody: JSON.stringify({ event: 'user.created', userId: '123' }),
}))

// Receive with long polling
const { Messages } = await client.send(new ReceiveMessageCommand({
  QueueUrl,
  MaxNumberOfMessages: 10,
  WaitTimeSeconds: 20,
}))
```

**Scales to millions of agents.** Each agent gets its own isolated message queue on Cloudflare's edge network. No shared state. No noisy neighbors. Just fast, reliable message passing at global scale.

## Installation

```bash
npm install @dotdo/sqs
```

## Quick Start

```typescript
import {
  SQSClient,
  CreateQueueCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@dotdo/sqs'

// Create client
const client = new SQSClient({ region: 'us-east-1' })

// Create a queue
const { QueueUrl } = await client.send(new CreateQueueCommand({
  QueueName: 'my-queue',
}))

// Send a message
await client.send(new SendMessageCommand({
  QueueUrl,
  MessageBody: JSON.stringify({ event: 'user.created', userId: '123' }),
}))

// Receive messages with long polling
const { Messages } = await client.send(new ReceiveMessageCommand({
  QueueUrl,
  MaxNumberOfMessages: 10,
  WaitTimeSeconds: 20,
}))

// Process and delete messages
for (const message of Messages ?? []) {
  console.log('Processing:', message.Body)

  await client.send(new DeleteMessageCommand({
    QueueUrl,
    ReceiptHandle: message.ReceiptHandle!,
  }))
}
```

## Features

- **API-compatible** with `@aws-sdk/client-sqs` v3
- **Standard and FIFO queues** with full support for message ordering and deduplication
- **Message visibility timeouts** for at-least-once delivery
- **Batch operations** for send, delete, and visibility changes
- **Message attributes** and system attributes
- **Queue tagging** for resource organization
- **MD5 hash verification** for message integrity
- **Edge-native** - runs on Cloudflare's global network

### FIFO Queues

```typescript
// Create FIFO queue (name must end with .fifo)
const { QueueUrl } = await client.send(new CreateQueueCommand({
  QueueName: 'orders.fifo',
  Attributes: {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'true',
  },
}))

// Send with message group ID for ordering
await client.send(new SendMessageCommand({
  QueueUrl,
  MessageBody: JSON.stringify({ orderId: '456' }),
  MessageGroupId: 'customer-123',
}))
```

### Batch Operations

```typescript
// Send multiple messages in one call
await client.send(new SendMessageBatchCommand({
  QueueUrl,
  Entries: [
    { Id: '1', MessageBody: 'First message' },
    { Id: '2', MessageBody: 'Second message', DelaySeconds: 10 },
    { Id: '3', MessageBody: 'Third message' },
  ],
}))

// Delete multiple messages in one call
await client.send(new DeleteMessageBatchCommand({
  QueueUrl,
  Entries: messages.map((m, i) => ({
    Id: `${i}`,
    ReceiptHandle: m.ReceiptHandle!,
  })),
}))
```

### Queue Attributes

```typescript
// Create queue with custom attributes
await client.send(new CreateQueueCommand({
  QueueName: 'configured-queue',
  Attributes: {
    VisibilityTimeout: '60',      // seconds
    MessageRetentionPeriod: '86400', // 1 day
    DelaySeconds: '5',            // default delay
    ReceiveMessageWaitTimeSeconds: '20', // long polling
  },
}))

// Get queue attributes
const { Attributes } = await client.send(new GetQueueAttributesCommand({
  QueueUrl,
  AttributeNames: ['All'],
}))

console.log('Messages in queue:', Attributes?.ApproximateNumberOfMessages)
```

### Message Visibility

```typescript
// Receive with custom visibility timeout
const { Messages } = await client.send(new ReceiveMessageCommand({
  QueueUrl,
  VisibilityTimeout: 300, // 5 minutes
}))

// Extend visibility timeout while processing
await client.send(new ChangeMessageVisibilityCommand({
  QueueUrl,
  ReceiptHandle: Messages![0].ReceiptHandle!,
  VisibilityTimeout: 600, // 10 minutes
}))

// Make message immediately visible again (return to queue)
await client.send(new ChangeMessageVisibilityCommand({
  QueueUrl,
  ReceiptHandle: Messages![0].ReceiptHandle!,
  VisibilityTimeout: 0,
}))
```

## API Reference

### Queue Operations
- `CreateQueueCommand` - Create a new queue
- `DeleteQueueCommand` - Delete a queue
- `ListQueuesCommand` - List all queues
- `GetQueueUrlCommand` - Get queue URL by name
- `GetQueueAttributesCommand` - Get queue attributes
- `SetQueueAttributesCommand` - Update queue attributes
- `PurgeQueueCommand` - Delete all messages in queue

### Message Operations
- `SendMessageCommand` - Send a single message
- `SendMessageBatchCommand` - Send up to 10 messages
- `ReceiveMessageCommand` - Receive messages
- `DeleteMessageCommand` - Delete a processed message
- `DeleteMessageBatchCommand` - Delete up to 10 messages
- `ChangeMessageVisibilityCommand` - Change message visibility
- `ChangeMessageVisibilityBatchCommand` - Change visibility for multiple

### Tag Operations
- `TagQueueCommand` - Add tags to queue
- `UntagQueueCommand` - Remove tags from queue
- `ListQueueTagsCommand` - List queue tags

## Error Handling

```typescript
import {
  QueueDoesNotExist,
  ReceiptHandleIsInvalid,
  EmptyBatchRequest,
} from '@dotdo/sqs'

try {
  await client.send(new SendMessageCommand({
    QueueUrl: 'nonexistent',
    MessageBody: 'test',
  }))
} catch (error) {
  if (error instanceof QueueDoesNotExist) {
    console.log('Queue not found')
  }
}
```

## Durable Object Integration

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withSQS } from '@dotdo/sqs/do'

class MyApp extends withSQS(DO) {
  async enqueueJob(jobData: object) {
    await this.$.sqs.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(jobData),
    }))
  }

  async processJobs() {
    const { Messages } = await this.$.sqs.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
    }))

    for (const message of Messages ?? []) {
      await this.handleJob(JSON.parse(message.Body!))
      await this.$.sqs.send(new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle!,
      }))
    }
  }
}
```

### Extended Configuration

Shard routing for multi-tenant queue isolation.

```typescript
import { SQSClient } from '@dotdo/sqs'

const client = new SQSClient({
  region: 'us-east-1',

  // Bind to DO namespace for persistence
  doNamespace: env.SQS_DO,

  // Shard queues by tenant
  shard: {
    algorithm: 'consistent',
    count: 16,
    key: 'tenant_id',
  },

  // Replica configuration for high availability
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
  },
})
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                          @dotdo/sqs                          │
├─────────────────────────────────────────────────────────────┤
│  AWS SQS Client API (SQSClient, Commands)                    │
├──────────────────────────────┬──────────────────────────────┤
│  Queue Management            │  Message Operations          │
│  - CreateQueue/DeleteQueue   │  - SendMessage               │
│  - ListQueues/GetQueueUrl    │  - ReceiveMessage            │
│  - GetQueueAttributes        │  - DeleteMessage             │
│  - SetQueueAttributes        │  - ChangeMessageVisibility   │
├──────────────────────────────┼──────────────────────────────┤
│  FIFO Support                │  Batch Operations            │
│  - Message ordering          │  - SendMessageBatch          │
│  - Deduplication             │  - DeleteMessageBatch        │
│  - Message groups            │  - ChangeVisibilityBatch     │
├──────────────────────────────┴──────────────────────────────┤
│                     Durable Object SQLite                    │
└─────────────────────────────────────────────────────────────┘
```

**Edge Layer (SQS API)**
- Drop-in replacement for @aws-sdk/client-sqs
- Full type safety with TypeScript
- Command pattern interface

**Storage Layer (Durable Object SQLite)**
- Microsecond access latency
- At-least-once delivery guarantees
- Automatic message visibility handling

## Comparison with AWS SQS

| Feature | @dotdo/sqs | @aws-sdk/client-sqs |
|---------|------------|---------------------|
| Edge Runtime | Yes | No |
| Standard Queues | Yes | Yes |
| FIFO Queues | Yes | Yes |
| Batch Operations | Yes | Yes |
| Long Polling | Yes | Yes |
| Dead Letter Queues | Yes | Yes |
| Zero Dependencies | Yes | No |
| Network Latency | Microseconds | Milliseconds |

## Performance

- **14 tests** covering all operations
- **Microsecond latency** for DO SQLite operations
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://sqs.do)
- [.do](https://do.org.ai)
- [Platform.do](https://platform.do)
