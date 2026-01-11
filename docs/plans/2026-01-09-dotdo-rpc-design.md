# @dotdo/rpc Design Document

## Vision

**One line of code to wrap ANY npm SDK in Cloudflare-native RPC.**

```typescript
import Stripe from 'stripe'
import OpenAI from 'openai'
import { Kafka } from 'kafkajs'

export const stripe = RPC(Stripe, { key: env.STRIPE_KEY })
export const openai = RPC(OpenAI, { apiKey: env.OPENAI_KEY })
export const kafka = RPC(Kafka, { brokers: ['...'] })
```

## Core Principles

1. **Zero boilerplate** - SDK works exactly like the original
2. **Type safety** - Full TypeScript inference from original SDK
3. **Promise pipelining** - Multiple calls batch into single round trip (Cap'n Web RPC)
4. **Intelligent routing** - Workers for pure JS, Containers for native code
5. **Transparent persistence** - State stored in Durable Objects automatically

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User Code                                    │
│  const customer = await stripe.customers.create({ email })          │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      RPC() Proxy Layer                               │
│  - Method interception via Proxy                                     │
│  - Serialization/deserialization                                     │
│  - Promise pipelining collection                                     │
│  - Runtime detection (Workers vs Container)                          │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              │                                               │
              ▼                                               ▼
┌─────────────────────────────┐               ┌─────────────────────────────┐
│   Workers V8 Isolate        │               │   Cloudflare Container      │
│   (Pure JS SDKs)            │               │   (Native SDKs)             │
│                             │               │                             │
│   - OpenAI                  │               │   - sharp                   │
│   - Stripe                  │               │   - better-sqlite3          │
│   - Anthropic               │               │   - puppeteer               │
│   - SendGrid                │               │   - ffmpeg                  │
│   - Most HTTP-based SDKs    │               │   - canvas                  │
└─────────────────────────────┘               └─────────────────────────────┘
              │                                               │
              └───────────────────────┬───────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Durable Object State                            │
│  - Object identity registry                                          │
│  - Session state                                                     │
│  - Connection pooling                                                │
└─────────────────────────────────────────────────────────────────────┘
```

## API Design

### Basic Usage

```typescript
import { RPC } from '@dotdo/rpc'
import Stripe from 'stripe'

// One line - full SDK functionality
export const stripe = RPC(Stripe, { args: [env.STRIPE_KEY] })

// Usage is identical to native SDK
const customer = await stripe.customers.create({ email: 'test@example.com.ai' })
const charge = await stripe.charges.create({
  amount: 1000,
  currency: 'usd',
  customer: customer.id
})
```

### Promise Pipelining (Cap'n Web RPC)

```typescript
// These look like 3 separate calls...
const customer = stripe.customers.create({ email })
const subscription = stripe.subscriptions.create({
  customer: customer.id,  // Reference to pending result!
  price: 'price_xxx'
})
const invoice = stripe.invoices.retrieve(subscription.latest_invoice)

// ...but execute in ONE network round trip
const result = await invoice
```

### Configuration Options

```typescript
interface RPCOptions<T> {
  // Constructor arguments for the SDK
  args?: ConstructorParameters<T>

  // Execution environment
  runtime?: 'auto' | 'worker' | 'container'

  // Persistence strategy
  persistence?: {
    mode: 'ephemeral' | 'session' | 'durable'
    ttl?: number  // Session TTL in seconds
  }

  // Streaming configuration
  streaming?: {
    methods: string[] | RegExp  // Methods that return streams
    mode: 'sse' | 'websocket' | 'chunked'
  }

  // Event handling for EventEmitter-based SDKs
  events?: {
    [eventName: string]:
      | 'websocket'           // Route to WebSocket
      | 'queue'               // Route to CF Queue
      | ((data: any) => void) // Custom handler
  }

  // Custom serializers for SDK-specific types
  serializers?: {
    [typeName: string]: {
      serialize: (value: any) => any
      deserialize: (value: any) => any
    }
  }

  // Method-specific configuration
  methods?: {
    [methodPath: string]: {
      timeout?: number
      retry?: { attempts: number, backoff: 'linear' | 'exponential' }
      cache?: { ttl: number, key?: (args: any[]) => string }
    }
  }
}
```

### Runtime Detection

```typescript
// Automatic detection based on SDK requirements
export const stripe = RPC(Stripe)        // → Workers (HTTP-based)
export const sharp = RPC(Sharp)          // → Container (native extension)
export const openai = RPC(OpenAI, {      // → Workers with streaming
  streaming: { methods: ['chat.completions.create'], mode: 'sse' }
})

// Manual override
export const customSDK = RPC(MySDK, { runtime: 'container' })
```

## Implementation

### Phase 1: Core Proxy System

```typescript
// packages/rpc/src/index.ts
export function RPC<T extends new (...args: any[]) => any>(
  SDK: T,
  options?: RPCOptions<T>
): InstanceType<T> {
  const runtime = detectRuntime(SDK, options)
  const executor = runtime === 'worker'
    ? new WorkerExecutor(SDK, options)
    : new ContainerExecutor(SDK, options)

  return createProxy(executor, [])
}

function createProxy(executor: Executor, path: string[]): any {
  return new Proxy(() => {}, {
    get(_, prop: string) {
      // Don't proxy Promise methods
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }
      // Navigate deeper into the object
      return createProxy(executor, [...path, prop])
    },

    apply(_, __, args) {
      // Collect call for pipelining
      return executor.enqueue({ path, args })
    }
  })
}
```

### Phase 2: Promise Pipelining

```typescript
// Collect multiple calls and execute in single round trip
class PipelineCollector {
  private calls: Call[] = []
  private flushing: Promise<void> | null = null

  enqueue(call: Call): Promise<any> {
    const index = this.calls.length
    this.calls.push(call)

    // Schedule flush on next microtask
    if (!this.flushing) {
      this.flushing = Promise.resolve().then(() => this.flush())
    }

    // Return promise that resolves when batch completes
    return this.flushing.then(() => this.results[index])
  }

  private async flush() {
    const batch = this.calls
    this.calls = []
    this.flushing = null

    // Execute all calls in single RPC
    const results = await this.executor.executeBatch(batch)
    this.results = results
  }
}
```

### Phase 3: Object Identity

```typescript
// Track objects returned from SDK for subsequent calls
class ObjectRegistry {
  private objects = new Map<string, any>()

  serialize(value: any): any {
    if (typeof value === 'object' && value !== null) {
      // Check if already registered
      for (const [id, obj] of this.objects) {
        if (obj === value) {
          return { __ref: id }
        }
      }

      // Register new object
      const id = crypto.randomUUID()
      this.objects.set(id, value)

      // Serialize properties recursively
      const serialized: any = { __type: value.constructor.name, __id: id }
      for (const [key, val] of Object.entries(value)) {
        serialized[key] = this.serialize(val)
      }
      return serialized
    }
    return value
  }

  deserialize(value: any): any {
    if (value?.__ref) {
      // Return existing object
      return this.objects.get(value.__ref)
    }
    if (value?.__id) {
      // Create proxy for remote object
      return createRemoteProxy(value.__id)
    }
    return value
  }
}
```

### Phase 4: Streaming Support

```typescript
// Handle streaming responses (OpenAI, etc.)
class StreamingHandler {
  async *handleStream(
    executor: Executor,
    call: Call
  ): AsyncGenerator<any> {
    // Open WebSocket to executor
    const ws = await executor.openStream(call)

    try {
      for await (const message of ws) {
        yield this.deserialize(message)
      }
    } finally {
      ws.close()
    }
  }
}

// Usage with OpenAI
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true
})

for await (const chunk of stream) {
  console.log(chunk.choices[0]?.delta?.content || '')
}
```

### Phase 5: Event Handling

```typescript
// Convert EventEmitter patterns to edge-compatible handlers
class EventBridge {
  constructor(
    private executor: Executor,
    private config: EventConfig
  ) {}

  on(event: string, handler: (data: any) => void) {
    const routing = this.config[event]

    if (routing === 'websocket') {
      // Subscribe via WebSocket
      this.subscribeWebSocket(event, handler)
    } else if (routing === 'queue') {
      // Route to Cloudflare Queue
      this.subscribeQueue(event, handler)
    } else if (typeof routing === 'function') {
      // Custom handler
      routing(handler)
    }
  }

  private subscribeWebSocket(event: string, handler: Function) {
    const ws = this.executor.getEventSocket()
    ws.addEventListener('message', (e) => {
      const { type, data } = JSON.parse(e.data)
      if (type === event) handler(data)
    })
    ws.send(JSON.stringify({ subscribe: event }))
  }
}
```

## Durable Object Backend

```typescript
// packages/rpc/src/executor-do.ts
export class RPCExecutor extends DurableObject {
  private instances = new Map<string, any>()
  private registry = new ObjectRegistry()

  async fetch(request: Request): Promise<Response> {
    const { action, payload } = await request.json()

    switch (action) {
      case 'init':
        return this.initialize(payload)
      case 'batch':
        return this.executeBatch(payload)
      case 'stream':
        return this.handleStream(request, payload)
      default:
        return new Response('Unknown action', { status: 400 })
    }
  }

  private async initialize({ sdk, args, instanceId }: InitPayload) {
    const SDK = await import(sdk)
    const instance = new SDK.default(...args)
    this.instances.set(instanceId, instance)
    return Response.json({ ok: true })
  }

  private async executeBatch({ instanceId, calls }: BatchPayload) {
    const instance = this.instances.get(instanceId)
    const results = []

    for (const { path, args } of calls) {
      // Navigate to method
      let target = instance
      for (const prop of path.slice(0, -1)) {
        target = target[prop]
      }

      // Execute method
      const method = path[path.length - 1]
      const result = await target[method](...this.registry.deserialize(args))
      results.push(this.registry.serialize(result))
    }

    return Response.json({ results })
  }
}
```

## Container Backend (for native SDKs)

```dockerfile
# packages/rpc/container/Dockerfile
FROM node:20-slim

WORKDIR /app

# Install native dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy RPC executor
COPY executor.js .
COPY package.json .

RUN npm install

EXPOSE 8080
CMD ["node", "executor.js"]
```

```typescript
// packages/rpc/container/executor.js
import express from 'express'

const app = express()
const instances = new Map()

app.post('/init', async (req, res) => {
  const { sdk, args, instanceId } = req.body
  const SDK = await import(sdk)
  instances.set(instanceId, new SDK.default(...args))
  res.json({ ok: true })
})

app.post('/batch', async (req, res) => {
  const { instanceId, calls } = req.body
  const instance = instances.get(instanceId)

  const results = []
  for (const { path, args } of calls) {
    let target = instance
    for (const prop of path.slice(0, -1)) {
      target = target[prop]
    }
    const method = path[path.length - 1]
    results.push(await target[method](...args))
  }

  res.json({ results })
})

app.listen(8080)
```

## SDK Compatibility Registry

```typescript
// packages/rpc/src/registry.ts
export const SDK_REGISTRY: Record<string, SDKConfig> = {
  // HTTP-based (Workers)
  'stripe': { runtime: 'worker' },
  'openai': { runtime: 'worker', streaming: ['chat.completions.create'] },
  '@anthropic-ai/sdk': { runtime: 'worker', streaming: ['messages.create'] },
  '@sendgrid/mail': { runtime: 'worker' },
  'resend': { runtime: 'worker' },
  '@sentry/node': { runtime: 'worker' },

  // Native extensions (Container)
  'sharp': { runtime: 'container' },
  'better-sqlite3': { runtime: 'container' },
  'canvas': { runtime: 'container' },
  'puppeteer': { runtime: 'container' },

  // Event-based (special handling)
  'kafkajs': {
    runtime: 'container',  // Long-running connections
    events: {
      'consumer.message': 'queue',
      'producer.ack': 'websocket'
    }
  },
  'socket.io': {
    runtime: 'worker',
    events: { '*': 'websocket' }
  }
}
```

## Usage Examples

### Stripe (HTTP-based, Workers)

```typescript
import { RPC } from '@dotdo/rpc'
import Stripe from 'stripe'

export const stripe = RPC(Stripe, { args: [env.STRIPE_KEY] })

// Works exactly like native Stripe SDK
export default {
  async fetch(request: Request, env: Env) {
    const customer = await stripe.customers.create({
      email: 'customer@example.com.ai'
    })

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: 'price_xxx' }]
    })

    return Response.json({ customer, subscription })
  }
}
```

### OpenAI (Streaming)

```typescript
import { RPC } from '@dotdo/rpc'
import OpenAI from 'openai'

export const openai = RPC(OpenAI, {
  args: [{ apiKey: env.OPENAI_KEY }],
  streaming: { methods: ['chat.completions.create'], mode: 'sse' }
})

export default {
  async fetch(request: Request, env: Env) {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello!' }],
      stream: true
    })

    return new Response(stream.toReadableStream(), {
      headers: { 'Content-Type': 'text/event-stream' }
    })
  }
}
```

### Sharp (Native, Container)

```typescript
import { RPC } from '@dotdo/rpc'
import sharp from 'sharp'

// Automatically runs in Container due to native extension
export const imageProcessor = RPC(sharp, { runtime: 'container' })

export default {
  async fetch(request: Request, env: Env) {
    const buffer = await request.arrayBuffer()

    const resized = await imageProcessor(Buffer.from(buffer))
      .resize(200, 200)
      .webp()
      .toBuffer()

    return new Response(resized, {
      headers: { 'Content-Type': 'image/webp' }
    })
  }
}
```

### Kafka (Long-running, Events)

```typescript
import { RPC } from '@dotdo/rpc'
import { Kafka } from 'kafkajs'

export const kafka = RPC(Kafka, {
  args: [{ brokers: ['kafka:9092'] }],
  runtime: 'container',
  events: {
    'consumer.message': 'queue'  // Route to CF Queue
  }
})

// Consumer runs in Container, messages routed to Queue
const consumer = kafka.consumer({ groupId: 'my-group' })
await consumer.subscribe({ topic: 'events' })
await consumer.run({
  eachMessage: async ({ message }) => {
    // This executes via CF Queue handler
    console.log(message.value.toString())
  }
})
```

## Implementation Phases

### Phase 1: MVP (2 weeks)
- [ ] Core Proxy system with method interception
- [ ] Basic serialization/deserialization
- [ ] Workers executor for HTTP-based SDKs
- [ ] OpenAI, Stripe, Anthropic support

### Phase 2: Advanced Features (2 weeks)
- [ ] Promise pipelining
- [ ] Object identity tracking
- [ ] Streaming support (SSE)
- [ ] Container executor for native SDKs

### Phase 3: Production Ready (2 weeks)
- [ ] Event handling (EventEmitter bridge)
- [ ] SDK compatibility registry
- [ ] Error handling and retries
- [ ] Comprehensive tests

### Phase 4: Ecosystem (ongoing)
- [ ] Codegen for type-safe wrappers
- [ ] Documentation and examples
- [ ] Community SDK contributions
- [ ] Performance optimizations

## Success Metrics

1. **Adoption**: 90% of compat layers can use RPC() with zero custom code
2. **Performance**: < 5ms overhead per RPC call within same isolate
3. **Type Safety**: 100% TypeScript inference preservation
4. **Developer Experience**: npm install → 1 line of code → working SDK

## Open Questions

1. **Fly.io fallback**: Should we support Fly.io for workloads exceeding Container limits?
2. **SDK bundling**: How to handle SDKs that import Node.js built-ins unconditionally?
3. **Version pinning**: How to handle SDK version mismatches between worker and container?
4. **Cold start mitigation**: Pre-warming strategies for Container-based SDKs?

## References

- [Cap'n Proto RPC](https://capnproto.org/rpc.html)
- [Cloudflare Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [JavaScript Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)
