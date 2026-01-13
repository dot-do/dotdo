# @dotdo/sqs

AWS SQS SDK compat layer for Cloudflare Workers with Durable Object backing.

Drop-in replacement for `@aws-sdk/client-sqs` that runs on Cloudflare Workers with in-memory storage backed by Durable Objects.

## Features

- **API-compatible** with `@aws-sdk/client-sqs` v3
- **Standard and FIFO queues** with full support for message ordering and deduplication
- **Message visibility timeouts** for at-least-once delivery
- **Batch operations** for send, delete, and visibility changes
- **Message attributes** and system attributes
- **Queue tagging** for resource organization
- **MD5 hash verification** for message integrity
- **Edge-native** - runs on Cloudflare's global network

## Installation

```bash
npm install @dotdo/sqs
```

## Usage

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

## FIFO Queues

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

## Batch Operations

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

## Queue Attributes

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

## Message Visibility

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

## Available Commands

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

## License

MIT
