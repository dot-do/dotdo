# SQS Queue Processing

**SQS queues. No AWS. No bills.**

```typescript
import { SQS } from '@dotdo/sqs'

const sqs = new SQS()

// Send a job
await sqs.sendMessage({
  QueueUrl: 'jobs',
  MessageBody: JSON.stringify({ type: 'email', to: 'user@example.com' })
})

// Process with automatic retries
const { Messages } = await sqs.receiveMessage({
  QueueUrl: 'jobs',
  MaxNumberOfMessages: 10,
  WaitTimeSeconds: 20
})

// Done? Delete it
await sqs.deleteMessage({
  QueueUrl: 'jobs',
  ReceiptHandle: message.ReceiptHandle
})
```

**Process 10,000 jobs. Pay for compute, not queue fees.**

---

## Features

### Send Messages

Queue jobs for async processing. Add delay for rate limiting.

```typescript
await sqs.sendMessage({
  QueueUrl: 'emails',
  MessageBody: JSON.stringify({
    to: 'user@example.com',
    template: 'welcome'
  }),
  DelaySeconds: 30  // Wait 30s before processing
})
```

### Batch Operations

Send up to 10 messages in one call.

```typescript
const result = await sqs.sendMessageBatch({
  QueueUrl: 'notifications',
  Entries: users.map((user, i) => ({
    Id: `msg-${i}`,
    MessageBody: JSON.stringify({ userId: user.id, event: 'signup' })
  }))
})

console.log(`Sent: ${result.Successful?.length}`)
console.log(`Failed: ${result.Failed?.length}`)
```

### Visibility Timeout

Messages stay invisible while being processed. If processing fails, they reappear automatically.

```typescript
// Receive - message hidden for 30 seconds
const { Messages } = await sqs.receiveMessage({
  QueueUrl: 'jobs',
  VisibilityTimeout: 30
})

// Taking longer? Extend the timeout
await sqs.changeMessageVisibility({
  QueueUrl: 'jobs',
  ReceiptHandle: message.ReceiptHandle,
  VisibilityTimeout: 60  // Another 60 seconds
})
```

### Exponential Backoff Retries

Built-in retry logic with configurable backoff.

```typescript
async function processWithRetry(message: Message, attempt = 1) {
  try {
    await processJob(JSON.parse(message.Body!))
    await sqs.deleteMessage({
      QueueUrl: 'jobs',
      ReceiptHandle: message.ReceiptHandle!
    })
  } catch (error) {
    if (attempt < 5) {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = Math.pow(2, attempt - 1)
      await sqs.changeMessageVisibility({
        QueueUrl: 'jobs',
        ReceiptHandle: message.ReceiptHandle!,
        VisibilityTimeout: delay
      })
    } else {
      // Move to dead letter queue
      await sqs.sendMessage({
        QueueUrl: 'jobs-dlq',
        MessageBody: message.Body!
      })
      await sqs.deleteMessage({
        QueueUrl: 'jobs',
        ReceiptHandle: message.ReceiptHandle!
      })
    }
  }
}
```

### Dead Letter Queue

Failed messages go to a DLQ for investigation.

```typescript
// Create main queue with DLQ
await sqs.createQueue({
  QueueName: 'orders',
  Attributes: {
    RedrivePolicy: JSON.stringify({
      deadLetterTargetArn: 'arn:aws:sqs:us-east-1:000000000000:orders-dlq',
      maxReceiveCount: '5'
    })
  }
})

// Check DLQ for failed jobs
const failed = await sqs.receiveMessage({
  QueueUrl: 'orders-dlq',
  MaxNumberOfMessages: 10
})
```

### FIFO Queues

Guarantee ordering and exactly-once delivery.

```typescript
// Create FIFO queue (name must end with .fifo)
await sqs.createQueue({
  QueueName: 'payments.fifo',
  Attributes: {
    FifoQueue: 'true',
    ContentBasedDeduplication: 'true'
  }
})

// Send with ordering guarantee
await sqs.sendMessage({
  QueueUrl: 'payments.fifo',
  MessageBody: JSON.stringify({ orderId: '123', amount: 99.99 }),
  MessageGroupId: 'customer-456'  // All messages for this customer processed in order
})
```

---

## Quick Start

```bash
# Install
npm install

# Run locally
npm run dev

# Deploy
npm run deploy
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /jobs` | Queue a new job |
| `GET /jobs` | Receive pending jobs |
| `DELETE /jobs/:receiptHandle` | Mark job complete |
| `POST /jobs/batch` | Queue multiple jobs |
| `GET /stats` | Queue statistics |
| `GET /dlq` | View dead letter queue |

## Example: Image Processing

```typescript
// Producer: Queue image resize job
app.post('/upload', async (c) => {
  const { imageUrl, sizes } = await c.req.json()

  await sqs.sendMessage({
    QueueUrl: 'image-processing',
    MessageBody: JSON.stringify({ imageUrl, sizes })
  })

  return c.json({ status: 'queued' })
})

// Consumer: Process images in background
$.every.second(async () => {
  const { Messages } = await sqs.receiveMessage({
    QueueUrl: 'image-processing',
    MaxNumberOfMessages: 5
  })

  for (const message of Messages ?? []) {
    const { imageUrl, sizes } = JSON.parse(message.Body!)
    await resizeImage(imageUrl, sizes)

    await sqs.deleteMessage({
      QueueUrl: 'image-processing',
      ReceiptHandle: message.ReceiptHandle!
    })
  }
})
```

---

Built with [dotdo](https://dotdo.dev) | Drop-in replacement for [@aws-sdk/client-sqs](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/sqs/)
