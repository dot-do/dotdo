# qstash.do

**Serverless messaging for AI workflows.** Drop-in QStash replacement. Durable execution. 20 tests.

[![npm version](https://img.shields.io/npm/v/@dotdo/qstash.svg)](https://www.npmjs.com/package/@dotdo/qstash)
[![Tests](https://img.shields.io/badge/tests-20%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why qstash.do?

**QStash is great for serverless messaging.** But you're paying for another service, managing API keys, and dealing with webhook complexity.

**qstash.do runs on your infrastructure.** 100% API-compatible with `@upstash/qstash`, but executes on dotdo's durable execution runtime. No external dependencies. No webhook signatures to verify. Just reliable message delivery at edge latency.

**Scales to millions of messages.** Each message runs in an isolated V8 context on Cloudflare's global network. Built-in retries, deduplication, and scheduling - all powered by Durable Objects or CF Workflows.

```typescript
import { Client } from '@dotdo/qstash'

const client = new Client({ token: 'xxx' })

// Publish a message
await client.publishJSON({
  url: 'https://example.com/api/webhook',
  body: { hello: 'world' },
  delay: '5m',
})

// Schedule recurring jobs
await client.schedules.create({
  destination: 'https://example.com/api/daily-report',
  cron: '0 9 * * MON-FRI',
})
```

## Installation

```bash
npm install @dotdo/qstash
```

## Quick Start

```typescript
import { Client } from '@dotdo/qstash'

// Create client (token optional in compat mode)
const client = new Client({ token: process.env.QSTASH_TOKEN })

// Publish a message
const { messageId } = await client.publish({
  url: 'https://example.com/webhook',
  body: 'Hello from qstash.do!',
})

// Publish JSON (convenience method)
await client.publishJSON({
  url: 'https://example.com/webhook',
  body: { user: 'alice', action: 'signup' },
})

// With delay
await client.publish({
  url: 'https://example.com/webhook',
  body: 'Delayed message',
  delay: '10m',  // or delay: 60000 (ms)
})
```

## Features

### Message Publishing

Publish messages to any HTTP endpoint with automatic retries:

```typescript
const result = await client.publish({
  url: 'https://example.com/webhook',
  body: JSON.stringify({ event: 'user.created' }),
  method: 'POST',
  headers: {
    'X-Custom-Header': 'value',
  },
  retries: 5,
  timeout: 30,
  callback: 'https://example.com/on-success',
  failureCallback: 'https://example.com/on-failure',
})

console.log(result.messageId)  // msg_abc123...
```

### Scheduling

Create cron-based schedules for recurring messages:

```typescript
// Create a schedule
const { scheduleId } = await client.schedules.create({
  destination: 'https://example.com/api/daily-report',
  cron: '0 9 * * MON-FRI',  // Weekdays at 9 AM
  body: { report: 'daily' },
  method: 'POST',
})

// List all schedules
const schedules = await client.schedules.list()

// Get a specific schedule
const schedule = await client.schedules.get(scheduleId)

// Pause/resume
await client.schedules.pause(scheduleId)
await client.schedules.resume(scheduleId)

// Delete
await client.schedules.delete(scheduleId)
```

### Deduplication

Prevent duplicate message processing with built-in deduplication:

```typescript
// Explicit deduplication ID
await client.publish({
  url: 'https://example.com/webhook',
  body: 'process-order',
  deduplicationId: 'order-123',
})

// Second publish with same ID returns existing messageId
const result = await client.publish({
  url: 'https://example.com/webhook',
  body: 'process-order',
  deduplicationId: 'order-123',
})

console.log(result.deduplicated)  // true

// Content-based deduplication
await client.publish({
  url: 'https://example.com/webhook',
  body: 'same-content',
  contentBasedDeduplication: true,  // Hash body for dedup key
})
```

### Signature Verification

Verify webhook signatures for secure message handling:

```typescript
import { Receiver } from '@dotdo/qstash'

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
})

// In your webhook handler
async function handleWebhook(request: Request) {
  const signature = request.headers.get('Upstash-Signature')
  const body = await request.text()

  const isValid = await receiver.verify({
    signature,
    body,
    clockTolerance: 60,  // Allow 60s clock drift
  })

  if (!isValid) {
    return new Response('Invalid signature', { status: 401 })
  }

  // Process the message...
}
```

### Batch Operations

Publish multiple messages in a single call:

```typescript
const { responses } = await client.batch([
  { url: 'https://example.com/webhook1', body: 'message 1' },
  { url: 'https://example.com/webhook2', body: 'message 2' },
  { url: 'https://example.com/webhook3', body: 'message 3' },
])

// Each response includes messageId
responses.forEach((r) => console.log(r.messageId))
```

## Backend Options

qstash.do supports multiple execution backends based on your durability and cost requirements:

```
┌─────────────────────────────────────────────────────────────┐
│         Durable Objects (Default)                           │
├─────────────────────────────────────────────────────────────┤
│  Full consistency, real-time, WebSocket support             │
│  Best for: Low-latency, interactive workflows               │
│  Cost: Higher (wall-clock billing)                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│         Cloudflare Workflows                                │
├─────────────────────────────────────────────────────────────┤
│  Hot execution, out-of-band processing                      │
│  Best for: Long waits, scheduled jobs, background tasks     │
│  Cost: 100-1000x cheaper (CPU-only billing)                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│         Pipelines + Iceberg                                 │
├─────────────────────────────────────────────────────────────┤
│  Batch processing with 60s aggregation                      │
│  Best for: High-volume analytics, audit logs                │
│  Cost: Cheapest (batch writes to R2)                        │
└─────────────────────────────────────────────────────────────┘
```

Configure the backend:

```typescript
import { Client } from '@dotdo/qstash'
import { CFWorkflowsBackend } from '@dotdo/workflows/backends'

// Use CF Workflows for cost-efficient background jobs
const client = new Client({
  storage: new CFWorkflowsBackend(env.MY_WORKFLOW),
})

// Use DO state for real-time requirements
const client = new Client({
  state: this.ctx.storage,  // In a Durable Object
})
```

## API Reference

### Client Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `publish` | `PublishRequest` | `PublishResponse` | Publish a message to a URL |
| `publishJSON` | `PublishRequest<T>` | `PublishResponse` | Publish JSON with auto content-type |
| `batch` | `PublishRequest[]` | `BatchResponse` | Publish multiple messages |
| `enqueue` | `PublishRequest` | `PublishResponse` | Alias for publish |
| `getMessage` | `messageId: string` | `MessageMeta \| null` | Get message metadata |

### Schedules Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `create` | `ScheduleRequest` | `{ scheduleId }` | Create a cron schedule |
| `get` | `scheduleId: string` | `Schedule \| null` | Get schedule by ID |
| `list` | - | `Schedule[]` | List all schedules |
| `delete` | `scheduleId: string` | `void` | Delete a schedule |
| `pause` | `scheduleId: string` | `void` | Pause a schedule |
| `resume` | `scheduleId: string` | `void` | Resume a paused schedule |

### Receiver Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `verify` | `VerifyRequest` | `boolean` | Verify webhook signature |

### PublishRequest Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | `string` | - | Destination URL |
| `body` | `string \| object` | - | Request body |
| `method` | `string` | `'POST'` | HTTP method |
| `headers` | `Record<string, string>` | - | Custom headers |
| `delay` | `string \| number` | - | Delay before delivery |
| `retries` | `number` | `3` | Number of retry attempts |
| `callback` | `string` | - | Success callback URL |
| `failureCallback` | `string` | - | Failure callback URL |
| `deduplicationId` | `string` | - | Explicit dedup key |
| `contentBasedDeduplication` | `boolean` | `false` | Hash body for dedup |
| `timeout` | `number \| string` | - | Request timeout |

### ScheduleRequest Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `destination` | `string` | - | Destination URL |
| `cron` | `string` | - | Cron expression (5 or 6 fields) |
| `body` | `string \| object` | - | Request body |
| `method` | `string` | `'POST'` | HTTP method |
| `scheduleId` | `string` | auto | Custom schedule ID |
| `retries` | `number` | `3` | Number of retry attempts |
| `timeout` | `number` | - | Request timeout (seconds) |

## How It Works

```
Input: client.publish({ url, body, delay: '5m' })
         ↓
┌─────────────────────────────────────────┐
│         Message Processing              │
│    Generate messageId, parse options    │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Deduplication Check             │
│    Check cache for existing messageId   │
│    (1 hour dedup window)                │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Delay Handling                  │
│    Parse duration: '5m' → 300000ms      │
│    Schedule execution via DO alarm      │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Durable Execution               │
│    Execute with automatic retries       │
│    Track step state for replay          │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         HTTP Delivery                   │
│    POST to destination URL              │
│    Call success/failure callbacks       │
└─────────────────────────────────────────┘
         ↓
Output: { messageId, url, deduplicated }
```

## Comparison

| Feature | @upstash/qstash | @dotdo/qstash |
|---------|-----------------|---------------|
| API Compatibility | - | 100% |
| External Service | Yes | No |
| Edge Latency | ~50ms | <5ms |
| Pricing | Per message | Included |
| Webhook Signatures | Required | Optional |
| DO Integration | No | Native |
| CF Workflows | No | Native |
| Self-hosted | No | Yes |
| Multi-region | Limited | 300+ cities |

## Performance

- **20 tests** covering all operations
- **<5ms** for message publishing (edge)
- **<1ms** for deduplication checks (in-memory)
- **Automatic retries** with exponential backoff
- **1 hour** deduplication window

## Durable Object Integration

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { Client } from '@dotdo/qstash'

class MyWorkflow extends DO {
  qstash = new Client({ state: this.ctx.storage })

  async processOrder(orderId: string) {
    // Send confirmation email after 5 minutes
    await this.qstash.publishJSON({
      url: 'https://example.com/api/send-email',
      body: { orderId, type: 'confirmation' },
      delay: '5m',
    })

    // Schedule daily inventory check
    await this.qstash.schedules.create({
      destination: 'https://example.com/api/check-inventory',
      cron: '0 6 * * *',
      body: { warehouse: 'main' },
    })
  }
}
```

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://qstash.do)
- [QStash API Reference](https://upstash.com/docs/qstash)
- [.do](https://do.org.ai)
- [Platform.do](https://platform.do)
