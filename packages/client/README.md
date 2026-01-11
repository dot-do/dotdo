# @dotdo/client

RPC Client SDK for Durable Objects with WebSocket-first communication, automatic reconnection, and promise pipelining.

## Installation

```bash
npm install @dotdo/client
```

## Quick Start

```typescript
import { createClient } from '@dotdo/client'

// Define your DO methods and events
interface MyMethods {
  getUser(id: string): { name: string; email: string }
  updateUser(id: string, data: { name: string }): void
  getOrders(userId: string): Order[]
}

interface MyEvents {
  userUpdated: { id: string; name: string }
  orderCreated: Order
}

// Create a type-safe client
const client = createClient<MyMethods, MyEvents>('https://api.example.com.ai')

// Make RPC calls
const user = await client.getUser('123')
console.log(user.name)

// Chain methods with promise pipelining
const orders = await client.getUser('123').getOrders()
```

## Configuration

```typescript
const client = createClient<MyMethods, MyEvents>(url, {
  // Request timeout in milliseconds (default: 30000)
  timeout: 30000,

  // Enable request batching (default: true)
  batching: true,

  // Batch window in milliseconds (default: 0 - batch on microtask)
  batchWindow: 10,

  // Maximum requests per batch (default: 100)
  maxBatchSize: 100,

  // Maximum queued requests when offline (default: 1000)
  offlineQueueLimit: 1000,

  // Reconnection settings
  reconnect: {
    maxAttempts: Infinity,  // Keep trying forever
    baseDelay: 1000,        // Start with 1 second
    maxDelay: 30000,        // Cap at 30 seconds
    jitter: 0.1,            // 10% randomization
  },

  // Authentication
  auth: {
    token: 'your-auth-token',
  },
})
```

## Features

### WebSocket with HTTP Fallback

The client prefers WebSocket connections for real-time, bidirectional communication. When WebSocket is unavailable, it automatically falls back to HTTP with retry logic.

### Automatic Reconnection

Lost connections are automatically restored with exponential backoff:

```typescript
client.on('connectionStateChange', (state) => {
  // 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'
  console.log('Connection:', state)
})

// Check current state
console.log(client.connectionState)
```

### Promise Pipelining

Chain method calls that execute in a single network round-trip (Cap'n Proto style):

```typescript
// These execute as one request, not three
const result = await client
  .getUser('123')
  .getProfile()
  .getSettings()
```

### Request Batching

Multiple concurrent calls are automatically batched:

```typescript
// These three calls are sent as a single batch
const [user, orders, settings] = await Promise.all([
  client.getUser('123'),
  client.getOrders('123'),
  client.getSettings('123'),
])
```

### Real-Time Subscriptions

Subscribe to server-pushed events:

```typescript
const subscription = client.subscribe('userUpdated', (data) => {
  console.log('User updated:', data.id, data.name)
})

// Later, unsubscribe
subscription.unsubscribe()
```

### Offline Queue

Requests made while disconnected are queued and sent when the connection is restored:

```typescript
// Monitor queue changes
client.on('queueChange', (count) => {
  console.log('Queued requests:', count)
})

// Check queue size
console.log(client.queuedCallCount)

// Clear the queue if needed
client.clearQueue()
```

## TypeScript Usage

Define your method signatures for full type safety:

```typescript
interface TaskMethods {
  create(task: { title: string; done: boolean }): Task
  get(id: string): Task | null
  list(filter?: { done?: boolean }): Task[]
  update(id: string, data: Partial<Task>): Task
  delete(id: string): void
}

interface TaskEvents {
  taskCreated: Task
  taskUpdated: Task
  taskDeleted: { id: string }
}

const client = createClient<TaskMethods, TaskEvents>(url)

// Full autocomplete and type checking
const task = await client.create({ title: 'Hello', done: false })
//    ^? Task

client.subscribe('taskCreated', (task) => {
  //                             ^? Task
})
```

## Client Events

```typescript
// Connection state changes
client.on('connectionStateChange', (state) => { ... })

// Queue size changes
client.on('queueChange', (count) => { ... })

// Connection closed
client.on('close', (reason) => { ... })

// Errors
client.on('error', (error) => { ... })

// Remove listener
client.off('connectionStateChange', handler)
```

## API Reference

### `createClient<TMethods, TEvents>(url, config?)`

Creates a new RPC client instance.

### Client Properties

| Property | Type | Description |
|----------|------|-------------|
| `connectionState` | `ConnectionState` | Current connection state |
| `config` | `ClientConfig` | Current configuration |
| `queuedCallCount` | `number` | Number of queued requests |

### Client Methods

| Method | Description |
|--------|-------------|
| `on(event, callback)` | Add event listener |
| `off(event, callback)` | Remove event listener |
| `subscribe(channel, callback)` | Subscribe to server events |
| `configure(config)` | Update configuration |
| `clearQueue()` | Clear offline queue |
| `disconnect()` | Close connection |

## License

MIT
