# convex.do

**Convex for Cloudflare Workers.** Real-time backend API. Edge-native. Self-hosted.

[![npm version](https://img.shields.io/npm/v/@dotdo/convex.svg)](https://www.npmjs.com/package/@dotdo/convex)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why convex.do?

**You know Convex.** Your team knows Convex. Your codebase has queries, mutations, and real-time subscriptions.

**convex.do lets you keep that code.** Drop-in replacement for the Convex browser SDK that runs on Cloudflare Workers. No external backend. No vendor lock-in. No monthly bills.

**Scales to millions of agents.** Each agent gets isolated reactive storage backed by Durable Objects. Global edge deployment. Real-time subscriptions. Optimistic updates.

```typescript
import { ConvexClient } from '@dotdo/convex'

const client = new ConvexClient('https://your-deployment.convex.cloud', {
  doNamespace: env.CONVEX,
})

// One-shot query
const messages = await client.query(api.messages.list, { channel: 'general' })

// Real-time subscription
const unsubscribe = client.onUpdate(api.messages.list, { channel: 'general' }, (messages) => {
  console.log('Messages:', messages)
})

// Mutation with optimistic update
await client.mutation(api.messages.send, { body: 'Hello!' })
```

## Installation

```bash
npm install @dotdo/convex
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                      Your Application                            │
│                                                                  │
│   const client = new ConvexClient(url)                          │
│   client.onUpdate(api.messages.list, {}, callback)              │
│   await client.mutation(api.messages.send, { body: 'Hi' })      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     @dotdo/convex                                │
│                                                                  │
│   - Full Convex Browser SDK API                                  │
│   - Reactive subscription management                             │
│   - Optimistic update handling                                   │
│   - Authentication token flow                                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Durable Objects                               │
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│   │   Agent 1   │  │   Agent 2   │  │   Agent N   │            │
│   │   SQLite    │  │   SQLite    │  │   SQLite    │            │
│   │  Reactive   │  │  Reactive   │  │  Reactive   │            │
│   └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                  │
│   Global edge deployment - 300+ cities                          │
│   Real-time updates - instant propagation                       │
│   Durable storage - automatic replication                       │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Create a Client

```typescript
import { ConvexClient } from '@dotdo/convex'

// Default options
const client = new ConvexClient('https://your-deployment.convex.cloud')

// With DO configuration
const client = new ConvexClient('https://your-deployment.convex.cloud', {
  doNamespace: env.CONVEX,
  shard: { key: 'channel', count: 16 },
  replica: { jurisdiction: 'eu', readPreference: 'nearest' },
})
```

### One-Shot Queries

```typescript
// Simple query
const messages = await client.query(api.messages.list, {})

// Query with arguments
const message = await client.query(api.messages.get, { id: messageId })

// Query with pagination
const result = await client.query(api.messages.list, {
  paginationOpts: { numItems: 10, cursor: null },
})
```

### Real-Time Subscriptions

```typescript
// Subscribe to query updates
const unsubscribe = client.onUpdate(
  api.messages.list,
  { channel: 'general' },
  (messages) => {
    console.log('Messages updated:', messages)
  }
)

// With error handling
const unsubscribe = client.onUpdate(
  api.messages.list,
  {},
  (messages) => console.log(messages),
  (error) => console.error('Subscription error:', error)
)

// Unsubscribe when done
unsubscribe()
```

### Mutations

```typescript
// Create document
const id = await client.mutation(api.messages.send, {
  body: 'Hello, World!',
  author: 'Alice',
  channel: 'general',
})

// Update document
await client.mutation(api.messages.update, {
  id: messageId,
  body: 'Updated message',
})

// Delete document
await client.mutation(api.messages.remove, { id: messageId })
```

### Optimistic Updates

```typescript
await client.mutation(
  api.messages.send,
  { body: 'Sending...', author: 'Alice', channel: 'general' },
  {
    optimisticUpdate: (localStore, args) => {
      // Get current cached value
      const existing = localStore.getQuery(api.messages.list, { channel: 'general' }) ?? []

      // Immediately update with optimistic data
      localStore.setQuery(api.messages.list, { channel: 'general' }, [
        ...existing,
        {
          _id: 'temp-id',
          _creationTime: Date.now(),
          body: args.body,
          author: args.author,
          channel: args.channel,
        },
      ])
    },
  }
)
```

### Actions

Actions can call external APIs and perform side effects.

```typescript
// Call AI service
const response = await client.action(api.openai.chat, {
  prompt: 'What is the capital of France?',
})

// Search with embeddings
const results = await client.action(api.search.messages, {
  query: 'hello world',
  limit: 10,
})
```

### Authentication

```typescript
// Set auth token fetcher
client.setAuth(async () => {
  return await fetchTokenFromAuth0()
})

// With token change callback
client.setAuth(
  async () => getToken(),
  {
    onTokenChange: (isAuthenticated) => {
      console.log('Auth state:', isAuthenticated)
    },
  }
)

// Clear authentication
client.setAuth(null)
```

## API Reference

### ConvexClient

| Method | Description |
|--------|-------------|
| `new ConvexClient(url, options?)` | Create a new client |
| `client.query(query, args)` | Execute one-shot query |
| `client.onUpdate(query, args, callback, errorCallback?)` | Subscribe to reactive updates |
| `client.mutation(mutation, args, options?)` | Execute mutation |
| `client.action(action, args)` | Execute action |
| `client.setAuth(fetchToken, options?)` | Set authentication |
| `client.sync()` | Wait for pending mutations |
| `client.close()` | Close client and cleanup |

### Client Options

| Option | Type | Description |
|--------|------|-------------|
| `unsavedChangesWarning` | `boolean` | Warn before unload with unsaved changes |
| `skipConvexDeploymentUrlCheck` | `boolean` | Skip URL validation |
| `verbose` | `boolean` | Enable verbose logging |
| `doNamespace` | `DurableObjectNamespace` | DO binding for storage |
| `shard` | `ShardConfig` | Sharding configuration |
| `replica` | `ReplicaConfig` | Replication configuration |

### Mutation Options

| Option | Type | Description |
|--------|------|-------------|
| `optimisticUpdate` | `(localStore, args) => void` | Apply instant UI update |

### OptimisticLocalStore

| Method | Description |
|--------|-------------|
| `getQuery(query, args)` | Get cached query value |
| `setQuery(query, args, value)` | Set cached query value |

## Function Naming Convention

Functions follow the `tableName:operation` pattern:

```typescript
// Queries
'messages:list'    // List all messages
'messages:get'     // Get message by ID
'users:getByToken' // Get user by auth token

// Mutations
'messages:send'    // Create message
'messages:update'  // Update message
'messages:remove'  // Delete message

// Actions
'openai:chat'      // Call OpenAI API
'search:messages'  // Full-text search
```

## Document Types

All documents include system fields:

```typescript
interface Document {
  _id: DocumentId<TableName>  // Unique identifier
  _creationTime: number       // Unix timestamp (ms)
  // ... your fields
}
```

## Comparison

| Feature | Convex Cloud | @dotdo/convex |
|---------|--------------|---------------|
| Hosting | Managed | Self-hosted |
| Latency | Single region | Global edge (300+ cities) |
| Cold starts | N/A | 0ms |
| Pricing | Usage-based | Free (your infra) |
| Vendor lock-in | Yes | No |
| Real-time subscriptions | Yes | Yes |
| Optimistic updates | Yes | Yes |
| Type-safe queries | Yes | Yes |
| Pagination | Yes | Yes |
| Authentication | Built-in | Bring your own |
| Per-agent isolation | N/A | Automatic |

## Durable Object Integration

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withConvex } from '@dotdo/convex/do'

class ChatRoom extends withConvex(DO) {
  async onMessage(content: string, userId: string) {
    // this.convex is pre-configured
    await this.convex.mutation(api.messages.send, {
      body: content,
      author: userId,
      channel: this.id,
    })

    return this.convex.query(api.messages.list, {
      channel: this.id,
      paginationOpts: { numItems: 50, cursor: null },
    })
  }
}
```

### Extended Options

```typescript
const client = new ConvexClient('https://your-deployment.convex.cloud', {
  // Durable Object namespace binding
  doNamespace: env.CONVEX_DO,

  // Sharding configuration
  shard: {
    algorithm: 'consistent',  // 'consistent' | 'range' | 'hash'
    count: 16,
    key: 'channel',           // Shard by channel field
  },

  // Replica configuration
  replica: {
    readPreference: 'nearest',  // 'primary' | 'secondary' | 'nearest'
    writeThrough: true,
    jurisdiction: 'eu',         // 'eu' | 'us' | 'fedramp'
  },
})
```

## Error Handling

```typescript
import { ConvexError } from '@dotdo/convex'

try {
  await client.mutation(api.messages.send, { body: 'Test' })
} catch (error) {
  if (error instanceof ConvexError) {
    console.log('Convex error:', error.message)
    console.log('Error code:', error.code)
    console.log('Error data:', error.data)
  }
}
```

## Client Lifecycle

```typescript
const client = new ConvexClient(url)

// Use client...

// Wait for all pending mutations
await client.sync()

// Close and cleanup
await client.close()
```

## Performance

- **0ms cold starts** - V8 isolates, not containers
- **Single-digit ms reads** - Local SQLite storage
- **Instant subscriptions** - No WebSocket connection overhead
- **Automatic batching** - Concurrent operations optimized
- **<2KB** added to bundle (tree-shakeable)

## Limitations

- No file storage (use R2 directly)
- No scheduled functions (use Workers Cron)
- No HTTP actions (use Workers routes)
- Actions are mocked in local mode

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://convex.do)
- [dotdo](https://dotdo.dev)
- [Platform.do](https://platform.do)
